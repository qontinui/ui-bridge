/**
 * API Spec Types
 *
 * Type definitions for API contract specifications.
 * Describes endpoints, request/response schemas, and data models
 * that connect frontend pages to backend services.
 */

// HTTP method
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Schema field
export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'any';
  required: boolean;
  description?: string;
  /** For object types, nested fields */
  fields?: SchemaField[];
  /** For array types, item type */
  items?: SchemaField;
  /** Example value */
  example?: unknown;
}

// API endpoint
export interface ApiEndpoint {
  id: string;
  /** HTTP method */
  method: HttpMethod;
  /** Path pattern, e.g. "/api/v1/invoices/:id" */
  path: string;
  description: string;
  /** Which feature this endpoint supports */
  featureId?: string;
  /** Request body schema (for POST/PUT/PATCH) */
  requestBody?: SchemaField[];
  /** Query parameters */
  queryParams?: SchemaField[];
  /** Path parameters */
  pathParams?: SchemaField[];
  /** Response body schema */
  responseBody?: SchemaField[];
  /** Expected HTTP status codes */
  statusCodes?: Array<{
    code: number;
    description: string;
  }>;
  /** Authentication required */
  auth: boolean;
}

// Data model / entity
export interface DataModel {
  id: string;
  name: string;
  description: string;
  fields: SchemaField[];
  /** Related models */
  relations?: Array<{
    modelId: string;
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
    foreignKey?: string;
    description?: string;
  }>;
}

// Main API config (the .api.uibridge.json format)
export interface ApiConfig {
  version: '1.0.0';
  /** Base URL for the API */
  basePath: string;
  description?: string;
  /** Auth mechanism used */
  authType?: 'none' | 'jwt' | 'api-key' | 'oauth' | 'session';
  endpoints: ApiEndpoint[];
  models: DataModel[];
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}

export const API_FILE_EXTENSION = '.api.uibridge.json';
export const API_CONFIG_VERSION = '1.0.0';
