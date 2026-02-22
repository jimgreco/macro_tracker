require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const heicConvert = require('heic-convert');
const {
  initDb,
  addEntries,
  updateEntry,
  deleteEntry,
  addSavedItem,
  updateSavedItem,
  deleteSavedItem,
  listSavedItems,
  quickAddFromSaved,
  claimLegacyData,
  getDashboard
} = require('./db');
const { parseMealText } = require('./parser');
const packageJson = require('../package.json');

const app = express();
const port = Number(process.env.PORT) || 3000;
app.set('trust proxy', 1);
const appBuild = process.env.APP_BUILD || 'c24d664';
const startedAtIso = new Date().toISOString();

const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const oauthCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/auth/google/callback`;



passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (googleClientId && googleClientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: oauthCallbackUrl
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const picture = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

        return done(null, {
          id: profile.id,
          name: profile.displayName,
          email,
          picture,
          provider: 'google'
        });
      }
    )
  );
}

app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      // Effectively no timeout for normal usage (~30 years).
      maxAge: 1000 * 60 * 60 * 24 * 365 * 30
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());

function todayIsoString() {
  return new Date().toISOString();
}

function parseImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (!match) {
    return null;
  }
  return {
    mimeType: String(match[1] || '').toLowerCase(),
    base64Payload: String(match[2] || '')
  };
}

function isHeicMimeType(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  return value === 'image/heic' || value === 'image/heif' || value === 'image/heic-sequence' || value === 'image/heif-sequence';
}

async function convertHeicDataUrlToJpegDataUrl(imageDataUrl) {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) {
    throw new Error('Invalid image format. Use an image file.');
  }
  const inputBuffer = Buffer.from(parsed.base64Payload, 'base64');
  const output = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 0.9
  });
  const outputBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  return 'data:image/jpeg;base64,' + outputBuffer.toString('base64');
}

function userIdFromReq(req) {
  return req.user && req.user.id ? String(req.user.id) : '';
}

function isAuthConfigured() {
  return Boolean(googleClientId && googleClientSecret);
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized. Sign in with Google first.' });
  }

  return res.redirect('/login');
}

function validateItems(items, consumedAt) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.map((item) => ({
    itemName: String(item.itemName || '').trim(),
    quantity: Number(item.quantity || 0),
    unit: item.unit || 'serving',
    calories: Number(item.calories || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0),
    consumedAt: item.consumedAt || consumedAt || todayIsoString()
  }));
}

function validateEntryBody(body) {
  const consumedAt = body.consumedAt || todayIsoString();
  const itemName = String(body.itemName || '').trim();

  if (!itemName) {
    throw new Error('itemName is required.');
  }

  return {
    itemName,
    quantity: Number(body.quantity || 0),
    unit: String(body.unit || 'serving').trim(),
    calories: Number(body.calories || 0),
    protein: Number(body.protein || 0),
    carbs: Number(body.carbs || 0),
    fat: Number(body.fat || 0),
    consumedAt: new Date(consumedAt).toISOString()
  };
}

function validateSavedItemBody(body) {
  const name = String(body.name || '').trim();
  if (!name) {
    throw new Error('name is required.');
  }

  return {
    name,
    quantity: Number(body.quantity || 1),
    unit: String(body.unit || 'serving').trim(),
    calories: Number(body.calories || 0),
    protein: Number(body.protein || 0),
    carbs: Number(body.carbs || 0),
    fat: Number(body.fat || 0)
  };
}

app.get('/login', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/');
  }

  return res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
});

app.get('/auth/google', (req, res, next) => {
  if (!isAuthConfigured()) {
    return res.status(500).send('Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!isAuthConfigured()) {
      return res.status(500).send('Google OAuth is not configured.');
    }
    return next();
  },
  passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.post('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user || null });
});

function getVersionPayload() {
  return {
    appBuild,
    packageVersion: packageJson.version,
    nodeVersion: process.version,
    startedAt: startedAtIso,
    heicServerConversion: true
  };
}

app.get('/version', (req, res) => {
  res.json(getVersionPayload());
});

app.get('/api/version', (req, res) => {
  res.json(getVersionPayload());
});

app.use('/api', requireAuth);

app.post('/api/parse-meal', async (req, res) => {
  let hasImage = false;
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const rawImageDataUrl = typeof req.body.imageDataUrl === 'string' ? req.body.imageDataUrl : '';
    hasImage = Boolean(rawImageDataUrl);
    let imageDataUrl = rawImageDataUrl;

    if (!text.trim() && !rawImageDataUrl) {
      return res.status(400).json({ error: 'Add a description, a photo, or both.' });
    }

    if (rawImageDataUrl) {
      const parsedImage = parseImageDataUrl(rawImageDataUrl);
      if (!parsedImage) {
        return res.status(400).json({ error: 'Invalid image format. Use an image file.' });
      }
      const mimeType = parsedImage.mimeType;
      const allowedMimeTypes = new Set([
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/heic',
        'image/heif',
        'image/heic-sequence',
        'image/heif-sequence'
      ]);
      if (!allowedMimeTypes.has(mimeType)) {
        return res.status(400).json({
          error: 'Unsupported image type. Use JPEG, PNG, WEBP, GIF, or HEIC.'
        });
      }

      const maxImageBytes = 6 * 1024 * 1024;
      const estimatedBytes = Math.floor((parsedImage.base64Payload.length * 3) / 4);
      if (estimatedBytes > maxImageBytes) {
        return res.status(400).json({ error: 'Image is too large. Please use an image under 6MB.' });
      }

      if (isHeicMimeType(mimeType)) {
        imageDataUrl = await convertHeicDataUrlToJpegDataUrl(rawImageDataUrl);
      }
    }

    const parsed = await parseMealText({
      text,
      consumedAt,
      imageDataUrl
    });

    res.json(parsed);
  } catch (error) {
    const message = String(error?.message || 'Request failed');
    if (hasImage && message.includes('did not match the expected pattern')) {
      return res.status(400).json({
        error: 'Photo format was not accepted. Please retry with a JPEG/PNG image or add a short description.'
      });
    }
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/entries/bulk', async (req, res) => {
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const rows = validateItems(req.body.items, consumedAt);

    if (!rows.length) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }

    const userId = userIdFromReq(req);
    await addEntries(userId, rows);

    const saveItems = Array.isArray(req.body.saveItems) ? req.body.saveItems : [];
    const savedIds = [];
    for (const saveItem of saveItems) {
      const id = await addSavedItem(userId, validateSavedItemBody(saveItem));
      savedIds.push(id);
    }

    return res.json({ ok: true, savedIds });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }

    const payload = validateEntryBody(req.body || {});
    const changes = await updateEntry(userIdFromReq(req), id, payload);

    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }

    const changes = await deleteEntry(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get('/api/saved-items', async (req, res) => {
  try {
    const items = await listSavedItems(userIdFromReq(req));
    res.json(items);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/saved-items', async (req, res) => {
  try {
    const id = await addSavedItem(userIdFromReq(req), validateSavedItemBody(req.body || {}));
    res.json({ id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/saved-items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid saved item id.' });
    }

    const payload = validateSavedItemBody(req.body || {});
    const changes = await updateSavedItem(userIdFromReq(req), id, payload);

    if (!changes) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/saved-items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid saved item id.' });
    }

    const changes = await deleteSavedItem(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/quick-add', async (req, res) => {
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const entry = await quickAddFromSaved(
      userIdFromReq(req),
      req.body.savedItemId,
      req.body.multiplier,
      consumedAt
    );

    if (!entry) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    return res.json({ ok: true, entry });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/claim-legacy-data', async (req, res) => {
  try {
    const result = await claimLegacyData(userIdFromReq(req));
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboard(userIdFromReq(req), req.query.date);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(requireAuth);
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

async function startServer() {
  try {
    await initDb();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Macro tracker listening on http://localhost:${port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize Postgres:', error);
    process.exit(1);
  }
}

startServer();
