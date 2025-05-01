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
  developerMode?: boolean;  // Optional developer mode
  includePersonContacts?: boolean;  // Optional setting to include person contacts
}

/**
 * Service class for interacting with the Scoro API
 * Provides methods for fetching and manipulating Scoro data
 */
export class ScoroApiService {
  private developerMode: boolean;
  
  constructor(private config: ScoroApiConfig) {
    this.developerMode = config.developerMode || false;
  }

  /**
   * Logs debug information if developerMode is enabled
   * @param message Debug message
   * @param data Optional data to log
   */
  private log(message: string, data?: any) {
    if (this.developerMode) {
      console.log(`[ScoroMD API] ${message}`, data || '');
    }
  }

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
      this.log('Validating API config');
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

      this.log('Making API request', { url, method: 'POST', payload });

      // Default to obsidian mode for CORS handling
      const mode = this.config.mode || 'obsidian';
      this.log('Using API mode', mode);
      
      let data: ScoroResponse<T>;
      
      if (mode === 'direct') {
        // Use direct fetch API (may encounter CORS issues)
        this.log('Using direct fetch API');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          this.log('Fetch API request failed', { status: res.status, statusText: res.statusText });
          throw new ScoroApiError(`HTTP error ${res.status}`, {
            status: res.status,
            statusText: res.statusText,
            url: path
          });
        }

        this.log('Fetch API request successful, parsing response');
        data = await res.json() as ScoroResponse<T>;
      } else {
        // Use Obsidian's requestUrl to avoid CORS issues
        this.log('Using Obsidian requestUrl API');
        const requestOptions: RequestUrlParam = {
          url: url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        };

        this.log('RequestUrl options', requestOptions);
        const res = await requestUrl(requestOptions);
        this.log('RequestUrl response', { status: res.status, headers: res.headers });

        if (res.status !== 200) {
          this.log('RequestUrl request failed', { status: res.status });
          throw new ScoroApiError(`HTTP error ${res.status}`, {
            status: res.status,
            statusText: res.status.toString(),
            url: path
          });
        }

        this.log('RequestUrl request successful, parsing response');
        data = res.json as ScoroResponse<T>;
      }
      
      this.log('API response received', { status: data.status, data: data });
      
      if (data.status !== 'OK') {
        this.log('API returned non-OK status', {
          status: data.status,
          statusCode: data.statusCode,
          messages: data.messages,
          url: path,
          data: data
        });
        console.error('API returned non-OK status', {
          status: data.status,
          statusCode: data.statusCode,
          messages: data.messages,
          url: path,
          data: data
        });
        throw new ScoroApiError('API returned error status', {
          status: data.status,
          statusCode: data.statusCode,
          messages: data.messages,
          url: path
        });
      }

      // Check if expected data structure exists before returning
      if (!data.data) {
        this.log('Invalid API response format - missing data property', {
          status: data.status,
          response: data,
          url: path
        });
        console.error('Invalid API response format', {
          status: data.status,
          response: data,
          url: path
        });
        throw new ScoroApiError('Invalid API response format', {
          status: data.status,
          response: data,
          url: path
        });
      }

      this.log('API request completed successfully', { path });
      return data.data;
    } catch (error) {
      this.log('Error in API request', {
        path: path,
        error: error
      });
      console.error('Error in API request', {
        path: path,
        error: error
      });
      
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
   * Also filters out contacts with type 'person' by default (configurable in settings)
   * 
   * @returns Promise resolving to an array of ScoroClient objects
   */
  async getClients() {
    const response = await this.post<ScoroListResponse<ScoroClient>>('contacts/list', {
      request: { company_type: 'customer' }
    });
    
    // Use any type for flexible property access 
    let anyResponse = response as any;
    
    if (this.developerMode) {
      console.log(`[ScoroMD Debug] Raw API response for clients:`, anyResponse);
    }
    
    // The response structure might be different than expected
    // If we have 'data' array but no 'items', map data to items
    if (!anyResponse.items && anyResponse.data && Array.isArray(anyResponse.data)) {
      if (this.developerMode) {
        console.log(`[ScoroMD Debug] Converting data array to items for clients`, anyResponse.data.length);
      }
      anyResponse.items = anyResponse.data;
    }
    
    // Handle case where response is directly an array
    if (!anyResponse.items && Array.isArray(anyResponse)) {
      if (this.developerMode) {
        console.log(`[ScoroMD Debug] Response is directly an array, converting to items`, anyResponse.length);
      }
      const tempResponse = { items: anyResponse };
      anyResponse = tempResponse;
    }
    
    // Ensure response has items array
    if (!anyResponse.items) {
      if (this.developerMode) {
        console.log(`[ScoroMD Debug] No items found in response, creating empty array`);
      }
      anyResponse.items = [];
    }
    
    // Filter out contacts with contact_type="person" unless includePersonContacts is true
    const includePersonContacts = this.config.includePersonContacts || false;
    if (!includePersonContacts && Array.isArray(anyResponse.items)) {
      const originalCount = anyResponse.items.length;
      anyResponse.items = anyResponse.items.filter((client: any) => 
        client.contact_type !== 'person'
      );
      
      if (this.developerMode) {
        console.log(`[ScoroMD Debug] Filtered out ${originalCount - anyResponse.items.length} person contacts`);
      }
    }
    
    if (this.developerMode) {
      console.log(`[ScoroMD Debug] Final processed client response:`, {
        itemsLength: anyResponse.items?.length,
        firstFew: anyResponse.items?.slice(0, 3)
      });
    }
    
    return anyResponse as ScoroListResponse<ScoroClient>;
  }

  // Project-related methods
  
  /**
   * Fetches the list of all projects from Scoro
   * 
   * @returns Promise resolving to an array of ScoroProject objects
   */
  async getProjects() {
    const response = await this.post<ScoroListResponse<ScoroProject>>('projects/list');
    
    // Ensure response has items array
    if (!response.items) {
      response.items = [];
    }
    
    return response;
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
   * Get tasks from Scoro API
   * @param options Optional pagination parameters
   * @returns Promise<ScoroListResponse<ScoroTask>>
   */
  async getTasks(options?: { page?: number; per_page?: number }): Promise<ScoroListResponse<ScoroTask>> {
    return this.post<ScoroListResponse<ScoroTask>>('tasks/list', {
      request: {},
      ...(options && {
        page: options.page,
        per_page: options.per_page
      })
    });
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

  /**
   * Get detailed task information using the view endpoint
   */
  async getTaskView(taskId: string): Promise<any> {
    try {
      const response = await this.post<any>(`tasks/view/${taskId}`, {
        request: {}
      });
      return response;
    } catch (error) {
      console.error('Failed to get task view:', error);
      throw error;
    }
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
    
    const response = await this.post<ScoroListResponse<ScoroTimeEntry>>('timeEntries/list', { 
      request: requestParams 
    });
    
    // Ensure response has items array
    if (!response.items) {
      response.items = [];
    }
    
    return response;
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