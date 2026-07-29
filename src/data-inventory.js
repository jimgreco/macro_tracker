const DATA_INVENTORY_VERSION = '2026-07-28';

const DISCLOSURE_GROUPS = Object.freeze({
  account: 'Account details',
  nutrition: 'Nutrition data',
  health: 'Workout, weight, sleep, and wellness entries',
  coaching: 'Coach Tony P.',
  billing: 'Subscription and billing state',
  authentication: 'Authentication and security records',
  operational: 'Operational usage records',
  diagnostics: 'Optional diagnostics'
});

const DATA_INVENTORY = Object.freeze([
  {
    table: 'schema_migrations',
    scope: 'system',
    purpose: 'Database schema history'
  },
  {
    table: 'users',
    scope: 'account',
    userColumn: 'id',
    disclosureGroup: 'account',
    accountDeletion: true,
    deleteOrder: 1000,
    export: {
      key: 'user',
      cardinality: 'one',
      columns: [
        'id',
        'email',
        'name',
        'picture',
        'provider',
        'timezone',
        'sexual_activity_enabled',
        'optional_diagnostics_enabled',
        'created_at',
        'updated_at'
      ]
    }
  },
  {
    table: 'user_identities',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'account',
    accountDeletion: true,
    deleteOrder: 10,
    export: {
      key: 'identities',
      columns: ['provider', 'provider_user_id', 'created_at', 'updated_at'],
      orderBy: 'provider'
    }
  },
  {
    table: 'entries',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'nutrition',
    accountDeletion: true,
    deleteOrder: 20,
    export: {
      key: 'entries',
      columns: [
        'id',
        'item_name',
        'quantity',
        'unit',
        'calories',
        'protein',
        'carbs',
        'fat',
        'consumed_at',
        'meal_group',
        'meal_name',
        'meal_quantity',
        'meal_unit',
        'source',
        'source_detail',
        'confidence',
        'needs_review',
        'correction_key',
        'created_at',
        'deleted_at'
      ],
      orderBy: 'consumed_at DESC, id DESC'
    }
  },
  {
    table: 'nutrition_day_completeness',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'nutrition',
    accountDeletion: true,
    deleteOrder: 30,
    export: {
      key: 'nutritionDayCompleteness',
      columns: ['local_date', 'state', 'timezone', 'created_at', 'updated_at'],
      orderBy: 'local_date DESC'
    }
  },
  {
    table: 'saved_items',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'nutrition',
    accountDeletion: true,
    deleteOrder: 40,
    export: {
      key: 'savedItems',
      columns: [
        'id',
        'name',
        'quantity',
        'unit',
        'calories',
        'protein',
        'carbs',
        'fat',
        'components',
        'source',
        'source_detail',
        'usage_count',
        'created_at',
        'deleted_at'
      ],
      orderBy: 'name, id'
    }
  },
  {
    table: 'food_corrections',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'nutrition',
    accountDeletion: true,
    deleteOrder: 50,
    export: {
      key: 'foodCorrections',
      columns: [
        'correction_key',
        'item_name',
        'quantity',
        'unit',
        'calories',
        'protein',
        'carbs',
        'fat',
        'source',
        'created_at',
        'updated_at'
      ],
      orderBy: 'updated_at DESC'
    }
  },
  {
    table: 'macro_targets',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'nutrition',
    accountDeletion: true,
    deleteOrder: 60,
    export: {
      key: 'macroTargets',
      columns: ['macro', 'target', 'effective_date', 'updated_at'],
      orderBy: 'effective_date DESC, macro'
    }
  },
  {
    table: 'weight_entries',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'health',
    accountDeletion: true,
    deleteOrder: 70,
    export: {
      key: 'weightEntries',
      columns: ['id', 'weight', 'logged_at', 'source', 'external_id', 'created_at', 'deleted_at'],
      orderBy: 'logged_at DESC, id DESC'
    }
  },
  {
    table: 'workout_entries',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'health',
    accountDeletion: true,
    deleteOrder: 80,
    export: {
      key: 'workoutEntries',
      columns: [
        'id',
        'description',
        'intensity',
        'duration_hours',
        'calories_burned',
        'logged_at',
        'source',
        'external_id',
        'created_at',
        'deleted_at'
      ],
      orderBy: 'logged_at DESC, id DESC'
    }
  },
  {
    table: 'sexual_activity_entries',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'health',
    accountDeletion: true,
    deleteOrder: 90,
    export: {
      key: 'sexualActivityEntries',
      columns: ['id', 'type', 'logged_at', 'source', 'external_id', 'created_at', 'deleted_at'],
      orderBy: 'logged_at DESC, id DESC'
    }
  },
  {
    table: 'sleep_entries',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'health',
    accountDeletion: true,
    deleteOrder: 100,
    export: {
      key: 'sleepEntries',
      columns: [
        'id',
        'duration_hours',
        'wake_ups',
        'quality',
        'notes',
        'logged_at',
        'source',
        'external_id',
        'created_at',
        'deleted_at'
      ],
      orderBy: 'logged_at DESC, id DESC'
    }
  },
  {
    table: 'weight_targets',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'health',
    accountDeletion: true,
    deleteOrder: 110,
    export: {
      key: 'weightTargets',
      columns: ['target_weight', 'target_date', 'effective_date', 'updated_at'],
      orderBy: 'effective_date DESC'
    }
  },
  {
    table: 'analysis_reports',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'coaching',
    accountDeletion: true,
    deleteOrder: 120,
    export: {
      key: 'analysisReports',
      columns: ['id', 'period_days', 'report_json', 'created_at', 'deleted_at'],
      orderBy: 'created_at DESC, id DESC'
    }
  },
  {
    table: 'subscriptions',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'billing',
    accountDeletion: true,
    deleteOrder: 200,
    export: {
      key: 'subscription',
      cardinality: 'one',
      columns: [
        'plan',
        'status',
        'current_period_start',
        'current_period_end',
        'cancel_at_period_end',
        'created_at',
        'updated_at'
      ]
    }
  },
  {
    table: 'billing_events',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'billing',
    accountDeletion: true,
    deleteOrder: 190,
    export: {
      key: 'billingEvents',
      columns: ['event_type', 'created_at'],
      orderBy: 'created_at DESC, id DESC'
    }
  },
  {
    table: 'api_tokens',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'authentication',
    accountDeletion: true,
    deleteOrder: 130,
    export: {
      key: 'apiCredentials',
      columns: ['id', 'name', 'created_at', 'expires_at', 'last_used_at'],
      orderBy: 'created_at DESC, id DESC'
    }
  },
  {
    table: 'web_sessions',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'authentication',
    accountDeletion: true,
    deleteOrder: 170,
    export: {
      key: 'webSessions',
      columns: ['public_id', 'expires_at', 'created_at', 'updated_at'],
      orderBy: 'updated_at DESC'
    }
  },
  {
    table: 'rate_limit_counters',
    scope: 'system',
    disclosureGroup: 'authentication',
    purpose: 'Hashed abuse-control buckets',
    retention: {
      mode: 'expired',
      column: 'expires_at'
    }
  },
  {
    table: 'audit_log',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'authentication',
    accountDeletion: true,
    deleteOrder: 210,
    retention: {
      days: 365,
      column: 'created_at'
    },
    export: {
      key: 'auditEvents',
      columns: ['id', 'action', 'entity_type', 'created_at'],
      orderBy: 'created_at DESC, id DESC'
    }
  },
  {
    table: 'daily_usage_counts',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'operational',
    accountDeletion: true,
    deleteOrder: 140,
    retention: {
      days: 90,
      column: 'usage_date'
    },
    export: {
      key: 'usageCounts',
      columns: ['feature', 'usage_date', 'count', 'updated_at'],
      orderBy: 'usage_date DESC, feature'
    }
  },
  {
    table: 'coach_dismissals',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'coaching',
    accountDeletion: true,
    deleteOrder: 150,
    export: {
      key: 'coachDismissals',
      columns: ['dismissal_type', 'dismissal_key', 'dismissed_until', 'created_at', 'updated_at'],
      orderBy: 'updated_at DESC'
    }
  },
  {
    table: 'client_diagnostics',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'diagnostics',
    accountDeletion: true,
    deleteOrder: 160,
    retention: {
      days: 30,
      column: 'created_at'
    },
    export: {
      key: 'clientDiagnostics',
      columns: [
        'id',
        'level',
        'category',
        'message',
        'details',
        'app_platform',
        'app_version',
        'request_id',
        'created_at'
      ],
      orderBy: 'created_at DESC, id DESC'
    }
  },
  {
    table: 'client_mutations',
    scope: 'account',
    userColumn: 'user_id',
    disclosureGroup: 'operational',
    accountDeletion: true,
    deleteOrder: 180,
    export: {
      key: 'clientMutations',
      columns: [
        'request_method',
        'request_path',
        'state',
        'response_status',
        'created_at',
        'completed_at'
      ],
      orderBy: 'created_at DESC'
    }
  }
]);

function accountDataInventory() {
  return DATA_INVENTORY.filter((item) => item.scope === 'account');
}

function accountDeletionInventory() {
  return accountDataInventory()
    .filter((item) => item.accountDeletion)
    .sort((left, right) => left.deleteOrder - right.deleteOrder);
}

function accountExportInventory() {
  return accountDataInventory().filter((item) => item.export);
}

function retentionInventory() {
  return DATA_INVENTORY.filter((item) => Number.isInteger(item.retention?.days));
}

module.exports = {
  DATA_INVENTORY_VERSION,
  DATA_INVENTORY,
  DISCLOSURE_GROUPS,
  accountDataInventory,
  accountDeletionInventory,
  accountExportInventory,
  retentionInventory
};
