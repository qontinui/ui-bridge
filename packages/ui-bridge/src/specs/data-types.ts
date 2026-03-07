/**
 * Data Spec Types
 *
 * Type definitions for persistence/database layer specifications.
 * Describes entities, columns, indexes, relationships, and seed data
 * at the database level — distinct from API data models which describe
 * request/response shapes.
 */

// Column/field type at the database level
export type ColumnType =
  | 'string'
  | 'text'
  | 'integer'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'enum'
  | 'binary'
  | 'array';

// A column in an entity/table
export interface DataColumn {
  name: string;
  type: ColumnType;
  /** Is this column required (NOT NULL)? */
  required: boolean;
  /** Is this the primary key or part of a composite PK? */
  primaryKey?: boolean;
  /** Is this column unique? */
  unique?: boolean;
  /** Default value expression */
  defaultValue?: string;
  description?: string;
  /** For enum types, the allowed values */
  enumValues?: string[];
  /** Max length for string/text columns */
  maxLength?: number;
}

// Index definition
export interface DataIndex {
  name: string;
  columns: string[];
  unique: boolean;
  description?: string;
}

// Relationship between entities
export interface DataRelation {
  id: string;
  /** Source entity ID */
  fromEntity: string;
  /** Source column(s) */
  fromColumns: string[];
  /** Target entity ID */
  toEntity: string;
  /** Target column(s) */
  toColumns: string[];
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  /** ON DELETE behavior */
  onDelete?: 'cascade' | 'set-null' | 'restrict' | 'no-action';
  /** ON UPDATE behavior */
  onUpdate?: 'cascade' | 'set-null' | 'restrict' | 'no-action';
  description?: string;
}

// An entity (table/collection)
export interface DataEntity {
  id: string;
  name: string;
  description: string;
  columns: DataColumn[];
  indexes?: DataIndex[];
  /** Soft delete column name (e.g. "deleted_at") */
  softDelete?: string;
  /** Timestamp columns managed automatically */
  timestamps?: {
    createdAt?: string;
    updatedAt?: string;
  };
}

// Seed data for an entity
export interface DataSeed {
  entityId: string;
  description: string;
  /** Number of records, or specific records */
  records: number | Array<Record<string, unknown>>;
  /** When to seed: always, development only, or on first setup */
  environment: 'all' | 'development' | 'setup';
}

// Migration step (for planned schema changes)
export interface DataMigration {
  id: string;
  description: string;
  /** Order in which migrations should run */
  order: number;
  /** Which entities this migration affects */
  entityIds: string[];
  /** Type of change */
  changeType:
    | 'create-table'
    | 'alter-table'
    | 'drop-table'
    | 'add-column'
    | 'drop-column'
    | 'add-index'
    | 'data-migration'
    | 'other';
}

// Main data config (the .data.uibridge.json format)
export interface DataConfig {
  version: '1.0.0';
  /** Database technology */
  database: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'other';
  description?: string;
  entities: DataEntity[];
  relations: DataRelation[];
  seeds?: DataSeed[];
  migrations?: DataMigration[];
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}

export const DATA_FILE_EXTENSION = '.data.uibridge.json';
export const DATA_CONFIG_VERSION = '1.0.0';
