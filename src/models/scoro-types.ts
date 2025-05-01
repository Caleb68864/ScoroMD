export interface ScoroResponse<T> {
  status: string;
  statusCode?: string;
  messages: string[];
  data: T;
}

export interface ScoroListResponse<T> {
  status: string;
  statusCode: number;
  messages: any;
  items?: T[];
  has_more?: boolean;  // Pagination flag
  page?: number;       // Current page
  per_page?: number;   // Items per page
  total?: number;      // Total number of items
}

export interface ScoroClient {
  company_id: string;
  company_name: string;
  company_type: string;
  contact_id: string;
  contact_name: string;
  email: string;
  phone: string;
}

export interface ScoroAddress {
  street?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface ScoroProject {
  project_id: string;
  name: string;
  description?: string;
  company_id?: string;
  company_name?: string;
  status_id: string;
  status_name: string;
  start_date?: string;
  deadline_date?: string;
}

export interface ScoroTask {
  task_id: string;
  event_id: string;
  event_name: string;
  description?: string;
  project_id?: string;
  project_name?: string;
  company_id?: string;
  company_name?: string;
  status_id: string;
  status_name: string;
  start_date?: string;
  deadline_date?: string;
}

export interface ScoroTimeEntry {
  time_entry_id: string;
  event_id: string;
  event_name: string;
  description?: string;
  project_id?: string;
  project_name?: string;
  company_id?: string;
  company_name?: string;
  datetime_start: string;
  datetime_end: string;
  duration: number;
  user_id: string;
  user_name: string;
}

export interface DailyNoteTimeEntry {
  task_name: string;
  datetime_start: string;
  datetime_end: string;
  description?: string;
  task_id?: string;
  time_entry_id?: string;
  file_path: string;
} 