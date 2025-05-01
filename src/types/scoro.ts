export interface ScoroClient {
  company_id?: string;
  contact_id?: string;
  company_name?: string;
  contact_name?: string;
  name?: string;
  [key: string]: any;
}

export interface ScoroProject {
  project_id: string;
  project_name: string;
  name?: string;
  company_id?: string;
  company_name?: string;
  description?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  [key: string]: any;
}

export interface ScoroTask {
  event_id: string;
  event_name: string;
  project_id?: string;
  project_name?: string;
  company_id?: string;
  company_name?: string;
  task_id?: string;
  [key: string]: any;
}

export interface ScoroTimeEntry {
  time_entry_id: string;
  event_id: string;
  datetime_start: string;
  datetime_end: string;
  description?: string;
  [key: string]: any;
}

export interface ScoroListResponse<T> {
  status: string;
  items?: T[];
  has_more?: boolean;
  messages?: string[];
  [key: string]: any;
}

export interface ScoroApiConfig {
  apiBase: string;
  apiKey: string;
  companyId: string;
  userId?: string;
  mode?: 'obsidian' | 'node';
  developerMode?: boolean;
  includePersonContacts?: boolean;
}

export interface ScoroApiError {
  message: string;
  details?: any;
}

export interface DailyNoteTimeEntry {
  task_id?: string;
  task_name: string;
  datetime_start: string;
  datetime_end: string;
  description?: string;
  time_entry_id?: string;
  file_path: string;
}

export interface ScoroSettings {
  apiBase: string;
  apiKey: string;
  companyId: string;
  userId: string;
  syncIntervalHours: number;
  developerMode: boolean;
  includePersonContacts: boolean;
  [key: string]: any;
} 