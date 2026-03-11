export interface AuthMethodResponse {
  method?: string;
  redirect_to?: string;
}

export interface OnTrackUser {
  id?: number;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  [key: string]: unknown;
}

export interface SignInResponse {
  auth_token: string;
  user: OnTrackUser;
}

export interface SessionData {
  baseUrl: string;
  username: string;
  authToken: string;
  user: OnTrackUser;
  savedAt: string;
}

export interface UnitSummary {
  id: number;
  code?: string;
  name?: string;
  myRole?: string;
  active?: boolean;
  [key: string]: unknown;
}

export interface TaskDefinitionSummary {
  id?: number;
  abbreviation?: string;
  name?: string;
  targetGrade?: number;
  [key: string]: unknown;
}

export interface TaskSummary {
  id: number;
  status?: string;
  grade?: string | number;
  qualityPts?: number;
  dueDate?: string;
  due_date?: string;
  completionDate?: string;
  completion_date?: string;
  submissionDate?: string;
  submission_date?: string;
  numNewComments?: number;
  num_new_comments?: number;
  taskDefinitionId?: number;
  task_definition_id?: number;
  definition?: {
    id?: number;
    abbreviation?: string;
    name?: string;
    targetGrade?: number;
  };
  [key: string]: unknown;
}

export interface InboxTask extends TaskSummary {
  projectId?: number;
  project_id?: number;
  unitId?: number;
  unit_id?: number;
  student?: OnTrackUser;
  [key: string]: unknown;
}

export interface ProjectSummary {
  id: number;
  targetGrade?: number;
  submittedGrade?: number;
  enrolled?: boolean;
  unit?: UnitSummary;
  student?: OnTrackUser;
  tasks?: TaskSummary[];
  [key: string]: unknown;
}

export interface TaskSelector {
  projectId: number;
  taskId?: number;
  abbr?: string;
}

export interface FeedbackItem {
  id: number;
  comment?: string;
  text?: string;
  type?: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  isNew?: boolean;
  is_new?: boolean;
  author?: OnTrackUser;
  recipient?: OnTrackUser;
  [key: string]: unknown;
}

export type WatchEventType = 'status_changed' | 'due_changed' | 'new_feedback';

export interface WatchEvent {
  type: WatchEventType;
  taskKey: string;
  projectId: number;
  taskId: number;
  unitCode?: string;
  abbr?: string;
  previous?: string | number | null;
  current?: string | number | null;
  deltaComments?: number;
  at: string;
}
