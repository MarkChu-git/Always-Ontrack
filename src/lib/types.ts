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

export interface TaskSummary {
  id: number;
  status?: string;
  grade?: string;
  qualityPts?: number;
  dueDate?: string;
  completionDate?: string;
  definition?: {
    id?: number;
    abbreviation?: string;
    name?: string;
    targetGrade?: number;
  };
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

