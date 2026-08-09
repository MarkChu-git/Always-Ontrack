/**
 * Shared API/domain types for the CLI.
 *
 * Notes:
 * - OnTrack responses are not fully stable across endpoints/roles.
 * - We keep many fields optional and support snake_case + camelCase variants.
 */
export interface AuthMethodResponse {
  // Auth strategy name reported by backend (e.g. "saml").
  method?: string;
  // IdP redirect entry URL for browser-based login.
  redirect_to?: string;
}

/** Common user object returned by auth, projects, comments, and session payloads. */
export interface OnTrackUser {
  // Numeric user id when exposed by endpoint.
  id?: number;
  // Login username (often email-like).
  username?: string;
  // Preferred contact email.
  email?: string;
  // CamelCase first name variant.
  firstName?: string;
  // snake_case first name variant.
  first_name?: string;
  // CamelCase last name variant.
  lastName?: string;
  // snake_case last name variant.
  last_name?: string;
  // Role from user payload.
  role?: string;
  // Alternate role key seen in some payloads.
  system_role?: string;
  // Preserve unknown fields for forward compatibility.
  [key: string]: unknown;
}

export interface SignInResponse {
  // Session auth token returned by `/api/auth`.
  auth_token: string;
  // Expiry when the server returns the access-token response variant.
  auth_token_expiry?: string;
  // Resolved signed-in user profile.
  user: OnTrackUser;
}

/** Verified `/auth/access-token` response shape captured from production. */
export interface AccessTokenResponse {
  auth_token: string;
  auth_token_expiry: string;
  user: OnTrackUser;
}

export type CredentialSource =
  | 'legacy'
  | 'manual-sign-in'
  | 'browser-sso'
  | 'access-token';

/** Local cached session payload stored on disk. */
export interface SessionData {
  // API base URL used to create this session.
  baseUrl: string;
  // Cached username associated with session token.
  username: string;
  // Persisted auth token used in request headers.
  authToken: string;
  // User profile snapshot at login time.
  user: OnTrackUser;
  // ISO timestamp recording local save time.
  savedAt: string;
  // Credential expiry supplied by the access-token contract when available.
  expiresAt?: string;
  // Provenance of the credential; absent records remain readable as legacy data.
  source?: CredentialSource;
  // ISO timestamp of the most recent credential refresh, when applicable.
  refreshedAt?: string;
}

/** Unit/course summary with optional task definition payloads. */
export interface UnitSummary {
  // Unit primary id.
  id: number;
  // Unit code (e.g. FIT1045).
  code?: string;
  // Human-readable unit name.
  name?: string;
  // CamelCase role field for current user in unit.
  myRole?: string;
  // snake_case role field for current user in unit.
  my_role?: string;
  // Whether unit is active.
  active?: boolean;
  // CamelCase task definitions list.
  taskDefinitions?: TaskDefinitionSummary[];
  // snake_case task definitions list.
  task_definitions?: TaskDefinitionSummary[];
  // Preserve unknown unit metadata.
  [key: string]: unknown;
}

/** File requirement metadata for upload-capable tasks. */
export interface TaskUploadRequirement {
  // Multipart key expected by upload endpoint (file0, file1, ...).
  key?: string;
  // Display name for requirement (server field; no `label` or per-file `max_size` exists).
  name?: string;
  // Requirement content category reported by the server (e.g. document, code).
  type?: string;
  // Preserve unknown requirement metadata.
  [key: string]: unknown;
}

/** Task definition metadata as exposed by unit/project endpoints. */
export interface TaskDefinitionSummary {
  // Task definition id.
  id?: number;
  // Short task code (P1, D4, etc.).
  abbreviation?: string;
  // Full task name.
  name?: string;
  // Target grade metadata for rubric workflows.
  targetGrade?: number;
  // CamelCase upload requirement list.
  uploadRequirements?: TaskUploadRequirement[];
  // snake_case upload requirement list.
  upload_requirements?: TaskUploadRequirement[];
  // Preserve unknown definition metadata.
  [key: string]: unknown;
}

/** Task instance within a project. */
export interface TaskSummary {
  // Task instance id in project.
  id: number;
  // Workflow status.
  status?: string;
  // Grade value when applicable.
  grade?: string | number;
  // Quality points when applicable.
  qualityPts?: number;
  // CamelCase due date.
  dueDate?: string;
  // snake_case due date.
  due_date?: string;
  // CamelCase completion date.
  completionDate?: string;
  // snake_case completion date.
  completion_date?: string;
  // CamelCase submission date.
  submissionDate?: string;
  // snake_case submission date.
  submission_date?: string;
  // CamelCase unread/new comment count.
  numNewComments?: number;
  // snake_case unread/new comment count.
  num_new_comments?: number;
  // CamelCase task definition id.
  taskDefinitionId?: number;
  // snake_case task definition id.
  task_definition_id?: number;
  // CamelCase upload requirements.
  uploadRequirements?: TaskUploadRequirement[];
  // snake_case upload requirements.
  upload_requirements?: TaskUploadRequirement[];
  // Embedded task definition object when provided.
  definition?: {
    // Embedded definition id.
    id?: number;
    // Embedded abbreviation.
    abbreviation?: string;
    // Embedded name.
    name?: string;
    // Embedded target grade.
    targetGrade?: number;
    // Embedded camelCase upload requirements.
    uploadRequirements?: TaskUploadRequirement[];
    // Embedded snake_case upload requirements.
    upload_requirements?: TaskUploadRequirement[];
    // Preserve unknown embedded fields.
    [key: string]: unknown;
  };
  // Preserve unknown task fields.
  [key: string]: unknown;
}

/** Inbox entry extends task with project/unit hints when available. */
export interface InboxTask extends TaskSummary {
  // CamelCase project id.
  projectId?: number;
  // snake_case project id.
  project_id?: number;
  // CamelCase unit id.
  unitId?: number;
  // snake_case unit id.
  unit_id?: number;
  // Student object for staff-view inbox entries.
  student?: OnTrackUser;
  // Preserve unknown inbox fields.
  [key: string]: unknown;
}

/** Project summary, typically with embedded unit and task arrays. */
export interface ProjectSummary {
  // Project id.
  id: number;
  // Requested/target grade.
  targetGrade?: number;
  // Submitted/achieved grade.
  submittedGrade?: number;
  // Enrollment flag for current user.
  enrolled?: boolean;
  // Associated unit summary.
  unit?: UnitSummary;
  // Project owner/student profile.
  student?: OnTrackUser;
  // Project task list.
  tasks?: TaskSummary[];
  // Preserve unknown project fields.
  [key: string]: unknown;
}

/** User-provided selector for task-level commands. */
export interface TaskSelector {
  // Required project id.
  projectId: number;
  // Optional explicit task definition id.
  taskDefinitionId?: number;
  // Deprecated compatibility selector: definition id or unique instance id.
  taskId?: number;
  // Optional task abbreviation (preferred UX selector).
  abbr?: string;
}

/** User-provided selector for batch-capable task commands. */
export interface TaskBatchSelector {
  // Required project id.
  projectId: number;
  // Optional list of explicit task definition ids.
  taskDefinitionIds: number[];
  // Deprecated compatibility selectors: definition ids or unique instance ids.
  taskIds: number[];
  // Optional list of task abbreviations.
  abbrs: string[];
  // When true, select all tasks in project.
  allTasks?: boolean;
}

/** Comment/event item returned by feedback endpoints. */
export interface FeedbackItem {
  // Feedback/comment id.
  id: number;
  // Main comment body.
  comment?: string;
  // Alternate text body field.
  text?: string;
  // Event/comment type.
  type?: string;
  // CamelCase created timestamp.
  createdAt?: string;
  // snake_case created timestamp.
  created_at?: string;
  // CamelCase updated timestamp.
  updatedAt?: string;
  // snake_case updated timestamp.
  updated_at?: string;
  // CamelCase "new" indicator.
  isNew?: boolean;
  // snake_case "new" indicator.
  is_new?: boolean;
  // Author profile.
  author?: OnTrackUser;
  // Recipient profile when present.
  recipient?: OnTrackUser;
  // Preserve unknown feedback fields.
  [key: string]: unknown;
}

export type SubmissionTrigger = 'need_help' | 'ready_for_feedback';

export type WatchEventType = 'status_changed' | 'due_changed' | 'new_feedback';

/** Normalized watch delta emitted by status/feedback polling loops. */
export interface WatchEvent {
  // Event category emitted by watch diff engine.
  type: WatchEventType;
  // Stable key format: `projectId:taskDefinitionId`.
  taskKey: string;
  // Project id for changed task.
  projectId: number;
  // Task definition id for changed task.
  taskDefinitionId: number;
  // Unit code for user-facing output.
  unitCode?: string;
  // Task abbreviation for user-facing output.
  abbr?: string;
  // Previous value (status/due/comment timestamp depending on event type).
  previous?: string | number | null;
  // Current value (status/due/comment timestamp depending on event type).
  current?: string | number | null;
  // Positive comment delta for feedback events.
  deltaComments?: number;
  // Event emission timestamp.
  at: string;
}
