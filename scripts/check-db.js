const db = require('../src/db');
require('../src/schema-contract').assertSchemaCompatible(db.getPool())
  .then(() => console.log('Database schema compatible.'))
  .catch(() => { console.error('Database schema incompatible; run the reviewed migration/adoption command.'); process.exitCode = 1; })
  .finally(() => db.getPool().end());
