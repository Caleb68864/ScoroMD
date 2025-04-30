/**
 * ScoroApiService - Service for interacting with the Scoro API
 * 
 * This service handles all communications with the Scoro API, providing methods
 * for retrieving and manipulating clients, projects, tasks, and time entries.
 * It abstracts the API complexity and provides a simple interface for the application.
 */

import {
  ScoroError,
  ScoroApiError,
  ScoroValidationError,
  NotificationService
} from '../utils/notifications';
import {
  ScoroResponse,
  ScoroListResponse,
  ScoroClient,
  ScoroProject,
  ScoroTask,
  ScoroTimeEntry
} from '../models/scoro-types';
import { requestUrl, RequestUrlParam } from 'obsidian';

/**
 * Configuration interface for the Scoro API service
 */
export interface ScoroApiConfig {
  apiBase: string;    // Base URL for the Scoro API (e.g., https://companyname.scoro.com)
  apiKey: string;     // API key for authentication
  companyId: string;  // Company account ID in Scoro
  userId: string;     // User ID for time entries and other operations
  mode?: 'direct' | 'obsidian';  // API request mode - direct uses fetch, obsidian uses requestUrl
}

/**
 * Service class for interacting with the Scoro API
 * Provides methods for fetching and manipulating Scoro data
 */
export class ScoroApiService {
  constructor(private config: ScoroApiConfig) {}

  /**
   * Validates that all required configuration fields are present
   * Throws a ScoroValidationError if any required field is missing
   * @private
   */
  private validateConfig() {
    if (!this.config.apiBase) {
      throw new ScoroValidationError('API base URL is required', 'apiBase');
    }
    if (!this.config.apiKey) {
      throw new ScoroValidationError('API key is required', 'apiKey');
    }
    if (!this.config.companyId) {
      throw new ScoroValidationError('Company ID is required', 'companyId');
    }
    if (!this.config.userId) {
      throw new ScoroValidationError('User ID is required', 'userId');
    }
  }

  /**
   * Generic method for making POST requests to the Scoro API
   * Handles authentication, error handling, and response parsing
   * 
   * @param path - API endpoint path (excluding the base URL and API version)
   * @param body - Request body to send (optional)
   * @returns Promise resolving to the response data
   * @throws ScoroApiError if the request fails or the API returns an error
   * @private
   */
  async post<T>(path: string, body: any = {}): Promise<T> {
    try {
      this.validateConfig();

      // Ensure we don't have double slashes in the URL
      const baseUrl = this.config.apiBase.endsWith('/') 
        ? this.config.apiBase.slice(0, -1) 
        : this.config.apiBase;
        
      const url = `${baseUrl}/api/v2/${path}`;
      const payload = {
        lang: 'eng',
        company_account_id: this.config.companyId,
        apiKey: this.config.apiKey,
        ...body
      };

      // Default to obsidian mode for CORS handling
      const mode = this.config.mode || 'obsidian';
      
      let data: ScoroResponse<T>;
      
      if (mode === 'direct') {
        // Use direct fetch API (may encounter CORS issues)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new ScoroApiError(`HTTP error ${res.status}`, {
            status: res.status,
            statusText: res.statusText,
            url: path
          });
        }

        data = await res.json() as ScoroResponse<T>;
      } else {
        // Use Obsidian's requestUrl to avoid CORS issues
        const requestOptions: RequestUrlParam = {
          url: url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        };

        const res = await requestUrl(requestOptions);

        if (res.status !== 200) {
          throw new ScoroApiError(`HTTP error ${res.status}`, {
            status: res.status,
            statusText: res.status.toString(),
            url: path
          });
        }

        data = res.json as ScoroResponse<T>;
      }
      
      if (data.status !== 'OK') {
        throw new ScoroApiError('API returned error status', {
          status: data.status,
          messages: data.messages,
          url: path
        });
      }

      return data.data;
    } catch (error) {
      if (error instanceof ScoroError) {
        throw error;
      }
      throw new ScoroApiError(`Failed to communicate with Scoro API: ${error.message}`, {
        originalError: error,
        url: path
      });
    }
  }

  // Client-related methods
  
  /**
   * Fetches the list of clients from Scoro
   * Filters to only include companies with type 'customer'
   * 
   * @returns Promise resolving to an array of ScoroClient objects
   */
  async getClients() {
    return this.post<ScoroListResponse<ScoroClient>>('contacts/list', {
      request: { company_type: 'customer' }
    });
  }

  // Project-related methods
  
  /**
   * Fetches the list of all projects from Scoro
   * 
   * @returns Promise resolving to an array of ScoroProject objects
   */
  async getProjects() {
    return this.post<ScoroListResponse<ScoroProject>>('projects/list');
  }

  /**
   * Fetches a specific project by ID
   * 
   * @param projectId - The ID of the project to fetch
   * @returns Promise resolving to a ScoroProject object
   */
  async getProject(projectId: string) {
    return this.post<ScoroProject>(`projects/view/${projectId}`);
  }

  // Task-related methods
  
  /**
   * Fetches the list of all tasks from Scoro
   * 
   * @returns Promise resolving to an array of ScoroTask objects
   */
  async getTasks() {
    return this.post<ScoroListResponse<ScoroTask>>('tasks/list');
  }

  /**
   * Fetches a specific task by ID
   * 
   * @param taskId - The ID of the task to fetch
   * @returns Promise resolving to a ScoroTask object
   * @throws ScoroValidationError if taskId is not provided
   */
  async getTask(taskId: string) {
    if (!taskId) {
      throw new ScoroValidationError('Task ID is required', 'taskId');
    }
    return this.post<ScoroTask>(`tasks/view/${taskId}`);
  }

  // Time Entry-related methods
  
  /**
   * Fetches time entries from Scoro with optional filtering
   * 
   * @param params - Optional parameters for filtering time entries
   *   - from_date: Start date for time entries (YYYY-MM-DD)
   *   - to_date: End date for time entries (YYYY-MM-DD)
   *   - user_id: Filter by user ID (defaults to config.userId if not provided)
   * @returns Promise resolving to an array of ScoroTimeEntry objects
   */
  async getTimeEntries(params: { 
    from_date?: string;
    to_date?: string;
    user_id?: string;
  } = {}) {
    const requestParams = { ...params };
    
    // Use configured userId if not provided in params
    if (!requestParams.user_id && this.config.userId) {
      requestParams.user_id = this.config.userId;
    }
    
    return this.post<ScoroListResponse<ScoroTimeEntry>>('timeEntries/list', { 
      request: requestParams 
    });
  }

  /**
   * Creates a new time entry in Scoro
   * 
   * @param data - Time entry data
   *   - event_id: ID of the task or event (required)
   *   - datetime_start: Start time in ISO format (required)
   *   - datetime_end: End time in ISO format (required)
   *   - description: Optional description for the time entry
   *   - user_id: User ID (defaults to config.userId if not provided)
   * @returns Promise resolving to the created ScoroTimeEntry
   * @throws ScoroValidationError if required fields are missing
   */
  async createTimeEntry(data: {
    event_id: string;
    datetime_start: string;
    datetime_end: string;
    description?: string;
    user_id?: string;
  }) {
    if (!data.event_id) {
      throw new ScoroValidationError('Event ID is required', 'event_id');
    }
    if (!data.datetime_start) {
      throw new ScoroValidationError('Start datetime is required', 'datetime_start');
    }
    if (!data.datetime_end) {
      throw new ScoroValidationError('End datetime is required', 'datetime_end');
    }
    
    const timeEntryData = { ...data };
    
    // Use configured userId if not provided
    if (!timeEntryData.user_id && this.config.userId) {
      timeEntryData.user_id = this.config.userId;
    }

    return this.post<ScoroTimeEntry>('timeEntries/modify', {
      request: {
        add: [timeEntryData]
      }
    });
  }

  /**
   * Updates an existing time entry in Scoro
   * 
   * @param timeEntryId - ID of the time entry to update
   * @param data - Data to update
   *   - datetime_start: New start time in ISO format
   *   - datetime_end: New end time in ISO format
   *   - description: New description
   * @returns Promise resolving to the updated ScoroTimeEntry
   * @throws ScoroValidationError if timeEntryId is not provided
   */
  async updateTimeEntry(timeEntryId: string, data: {
    datetime_start?: string;
    datetime_end?: string;
    description?: string;
  }) {
    if (!timeEntryId) {
      throw new ScoroValidationError('Time entry ID is required', 'timeEntryId');
    }

    return this.post<ScoroTimeEntry>('timeEntries/modify', {
      request: {
        modify: [{
          time_entry_id: timeEntryId,
          ...data
        }]
      }
    });
  }

  /**
   * Deletes a time entry from Scoro
   * 
   * @param timeEntryId - ID of the time entry to delete
   * @returns Promise resolving when deletion is complete
   * @throws ScoroValidationError if timeEntryId is not provided
   */
  async deleteTimeEntry(timeEntryId: string) {
    if (!timeEntryId) {
      throw new ScoroValidationError('Time entry ID is required', 'timeEntryId');
    }

    return this.post<void>('timeEntries/delete', {
      request: {
        time_entry_id: timeEntryId
      }
    });
  }
} 