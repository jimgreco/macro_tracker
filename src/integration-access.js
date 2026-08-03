const SOURCE_IDS = Object.freeze({
  HEALTHKIT: 'healthkit',
  OURA: 'oura',
  WORKOUT_PLANNER: 'workout_planner'
});

const OURA_LOGICAL_DATA_TYPE_MAP = Object.freeze({
  sleep: Object.freeze(['sleep', 'daily_sleep']),
  readiness: Object.freeze(['daily_readiness']),
  activity: Object.freeze(['daily_activity']),
  stress: Object.freeze(['daily_stress']),
  resilience: Object.freeze(['daily_resilience']),
  bedtime: Object.freeze(['sleep_time']),
  workouts: Object.freeze(['workout'])
});

const HEALTHKIT_DATA_TYPES = Object.freeze([
  {
    id: 'workouts',
    displayName: 'Workouts',
    detail: 'Import Apple Health workouts and add workouts logged in Macrovana to Apple Health.',
    readSupported: true,
    writeSupported: true
  },
  {
    id: 'weight',
    displayName: 'Weight',
    detail: 'Import body weight and add weight logged in Macrovana to Apple Health.',
    readSupported: true,
    writeSupported: true
  },
  {
    id: 'sleep',
    displayName: 'Sleep',
    detail: 'Import sleep sessions and add sleep logged in Macrovana to Apple Health.',
    readSupported: true,
    writeSupported: true
  }
]);

const HEALTHKIT_SEXUAL_ACTIVITY = Object.freeze({
  id: 'sexual_activity',
  displayName: 'Sexual Activity',
  detail: 'Import sexual activity and add activity logged in Macrovana to Apple Health.',
  readSupported: true,
  writeSupported: true
});

const OURA_DATA_TYPES = Object.freeze([
  {
    id: 'sleep',
    displayName: 'Sleep',
    detail: 'Import Oura sleep sessions and daily sleep scores.',
    readSupported: true,
    writeSupported: false
  },
  {
    id: 'readiness',
    displayName: 'Readiness',
    detail: 'Import Oura readiness scores and aggregate contributors.',
    readSupported: true,
    writeSupported: false
  },
  {
    id: 'activity',
    displayName: 'Activity',
    detail: 'Import Oura daily activity aggregates.',
    readSupported: true,
    writeSupported: false
  },
  {
    id: 'stress',
    displayName: 'Stress',
    detail: 'Import Oura daily stress and recovery aggregates.',
    readSupported: true,
    writeSupported: false
  },
  {
    id: 'resilience',
    displayName: 'Resilience',
    detail: 'Import Oura resilience levels and aggregate contributors.',
    readSupported: true,
    writeSupported: false
  },
  {
    id: 'bedtime',
    displayName: 'Bedtime',
    detail: 'Import Oura bedtime recommendations.',
    readSupported: true,
    writeSupported: false
  }
]);

const OURA_WORKOUTS = Object.freeze({
  id: 'workouts',
  displayName: 'Workouts',
  detail: 'Import workouts recorded by Oura.',
  readSupported: true,
  writeSupported: false
});

const WORKOUT_PLANNER_DATA_TYPES = Object.freeze([
  {
    id: 'workouts',
    displayName: 'Workouts',
    detail: 'Import completed workouts from Workout Planner.',
    readSupported: true,
    writeSupported: false
  }
]);

function catalogDataType(definition, sourceId) {
  const writeDisabledReason = definition.writeSupported
    ? undefined
    : sourceId === SOURCE_IDS.OURA
      ? 'Macrovana does not write health data to Oura.'
      : 'Macrovana does not write workouts to Workout Planner.';
  return {
    id: definition.id,
    displayName: definition.displayName,
    detail: definition.detail,
    read: {
      supported: Boolean(definition.readSupported),
      ...(!definition.readSupported ? { disabledReason: 'Reading this data type is not supported.' } : {})
    },
    write: {
      supported: Boolean(definition.writeSupported),
      ...(writeDisabledReason ? { disabledReason: writeDisabledReason } : {})
    }
  };
}

function sourceCatalog(sourceId, {
  sexualActivityEnabled = false,
  ouraWorkoutsEnabled = false
} = {}) {
  if (sourceId === SOURCE_IDS.HEALTHKIT) {
    const definitions = sexualActivityEnabled
      ? [...HEALTHKIT_DATA_TYPES, HEALTHKIT_SEXUAL_ACTIVITY]
      : [...HEALTHKIT_DATA_TYPES];
    return definitions.map((definition) => catalogDataType(definition, sourceId));
  }
  if (sourceId === SOURCE_IDS.OURA) {
    const definitions = ouraWorkoutsEnabled
      ? [...OURA_DATA_TYPES, OURA_WORKOUTS]
      : [...OURA_DATA_TYPES];
    return definitions.map((definition) => catalogDataType(definition, sourceId));
  }
  if (sourceId === SOURCE_IDS.WORKOUT_PLANNER) {
    return WORKOUT_PLANNER_DATA_TYPES.map((definition) => catalogDataType(definition, sourceId));
  }
  return null;
}

function permissionMap(permissions = []) {
  return new Map(
    (Array.isArray(permissions) ? permissions : []).map((permission) => [
      String(permission.dataType || permission.data_type || ''),
      {
        readEnabled: permission.readEnabled === true || permission.read_enabled === true,
        writeEnabled: permission.writeEnabled === true || permission.write_enabled === true
      }
    ])
  );
}

function sourceConfigurationRequired(dataTypes, permissions, { connected = true } = {}) {
  if (!connected) return false;
  const byDataType = permissionMap(permissions);
  return dataTypes.some((dataType) => !byDataType.has(dataType.id));
}

function buildSourceAccess({
  id,
  displayName,
  connected,
  available,
  unavailableReason,
  permissions = [],
  sexualActivityEnabled = false,
  ouraWorkoutsEnabled = false
}) {
  const dataTypes = sourceCatalog(id, { sexualActivityEnabled, ouraWorkoutsEnabled });
  if (!dataTypes) throw new Error(`Unsupported integration source: ${id}`);
  const byDataType = permissionMap(permissions);
  const result = {
    id,
    displayName,
    connected: Boolean(connected),
    available: Boolean(available),
    configurationRequired: sourceConfigurationRequired(dataTypes, permissions, {
      connected: Boolean(connected)
    }),
    dataTypes: dataTypes.map((dataType) => {
      const selection = byDataType.get(dataType.id);
      return {
        ...dataType,
        ...(selection ? { selection } : {})
      };
    })
  };
  if (!available && unavailableReason) result.unavailableReason = unavailableReason;
  return result;
}

function normalizeAccessSelection(sourceId, body, options = {}) {
  const catalog = sourceCatalog(sourceId, options);
  if (!catalog) throw new Error('Unknown integration source.');
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.dataTypes)) {
    throw new Error('dataTypes must be an array.');
  }

  const expected = new Map(catalog.map((dataType) => [dataType.id, dataType]));
  const seen = new Set();
  const normalized = body.dataTypes.map((selection) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new Error('Each dataTypes selection must be an object.');
    }
    const id = String(selection.id || '').trim();
    const capability = expected.get(id);
    if (!capability) throw new Error(`Unsupported ${sourceId} data type: ${id || 'missing'}.`);
    if (seen.has(id)) throw new Error(`Duplicate ${sourceId} data type: ${id}.`);
    seen.add(id);
    if (typeof selection.readEnabled !== 'boolean' || typeof selection.writeEnabled !== 'boolean') {
      throw new Error(`${id} readEnabled and writeEnabled must be booleans.`);
    }
    if (selection.readEnabled && !capability.read.supported) {
      throw new Error(`${id} read access is not supported for ${sourceId}.`);
    }
    if (selection.writeEnabled && !capability.write.supported) {
      throw new Error(`${id} write access is not supported for ${sourceId}.`);
    }
    return {
      dataType: id,
      readEnabled: selection.readEnabled,
      writeEnabled: selection.writeEnabled
    };
  });

  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  if (missing.length) {
    throw new Error(`Missing ${sourceId} data type selections: ${missing.join(', ')}.`);
  }
  return normalized;
}

function isIntegrationAccessEnabled(permissions, dataType, direction) {
  const selection = permissionMap(permissions).get(String(dataType || ''));
  if (!selection) return false;
  if (direction === 'read') return selection.readEnabled;
  if (direction === 'write') return selection.writeEnabled;
  return false;
}

function enabledOuraProviderDataTypes(permissions, { includeWorkouts = false } = {}) {
  const enabled = [];
  for (const [logicalType, providerTypes] of Object.entries(OURA_LOGICAL_DATA_TYPE_MAP)) {
    if (logicalType === 'workouts' && !includeWorkouts) continue;
    if (!isIntegrationAccessEnabled(permissions, logicalType, 'read')) continue;
    enabled.push(...providerTypes);
  }
  return enabled;
}

module.exports = {
  OURA_LOGICAL_DATA_TYPE_MAP,
  SOURCE_IDS,
  buildSourceAccess,
  enabledOuraProviderDataTypes,
  isIntegrationAccessEnabled,
  normalizeAccessSelection,
  sourceCatalog,
  sourceConfigurationRequired
};
