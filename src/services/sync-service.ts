import { ScoroApiService } from './scoro-api';
import { VaultService } from './vault-service';
import { NotificationService, ScoroValidationError, ScoroSyncError } from '../utils/notifications';
import {
  ScoroClient,
  ScoroProject,
  ScoroTask,
  ScoroTimeEntry,
  DailyNoteTimeEntry
} from '../models/scoro-types';

export class SyncService {
  private developerMode: boolean;
  
  constructor(
    private api: ScoroApiService,
    private vault: VaultService,
    developerMode: boolean = false
  ) {
    this.developerMode = developerMode;
  }

  private log(message: string, data?: any) {
    if (this.developerMode) {
      console.log(`[ScoroMD Debug] ${message}`, data || '');
    }
  }

  /**
   * Main sync method that orchestrates syncing all enabled data types
   */
  async syncAll(options?: {
    syncClients?: boolean;
    syncProjects?: boolean;
    syncTasks?: boolean;
    syncTimeEntries?: boolean;
  }) {
    try {
      this.log('Starting sync process');
      NotificationService.showInfo('Starting sync...');
      
      // Get sync settings from plugin
      const syncSettings = this.getSyncSettings();
      
      // Merge default settings with any provided options
      const syncOptions = {
        ...syncSettings,
        ...options
      };
      
      this.log('Sync options', syncOptions);
      
      // Only sync enabled data types
      if (syncOptions.syncClients) {
        this.log('Syncing clients...');
        await this.syncClients();
      } else {
        this.log('Skipping clients sync (disabled in settings)');
      }
      
      if (syncOptions.syncProjects) {
        this.log('Syncing projects...');
        await this.syncProjects();
      } else {
        this.log('Skipping projects sync (disabled in settings)');
      }
      
      if (syncOptions.syncTasks) {
        this.log('Syncing tasks...');
        await this.syncTasks();
      } else {
        this.log('Skipping tasks sync (disabled in settings)');
      }
      
      if (syncOptions.syncTimeEntries) {
        this.log('Syncing time entries...');
        await this.syncTimeEntries();
      } else {
        this.log('Skipping time entries sync (disabled in settings)');
      }
      
      this.log('Sync completed successfully');
      NotificationService.showSuccess('Sync completed successfully');
    } catch (error) {
      this.log('Sync failed with error', error);
      NotificationService.showError('Sync failed', error);
      throw error;
    }
  }
  
  /**
   * Gets the current sync settings from the plugin
   * @private
   */
  private getSyncSettings(): {
    syncClients: boolean;
    syncProjects: boolean;
    syncTasks: boolean;
    syncTimeEntries: boolean;
  } {
    // Try to get settings from the plugin
    try {
      // Access plugin settings through the vault service
      const settings = this.vault.getPluginSettings();
      if (settings) {
        return {
          syncClients: settings.syncClients !== undefined ? settings.syncClients : true,
          syncProjects: settings.syncProjects !== undefined ? settings.syncProjects : true,
          syncTasks: settings.syncTasks !== undefined ? settings.syncTasks : true,
          syncTimeEntries: settings.syncTimeEntries !== undefined ? settings.syncTimeEntries : true
        };
      }
    } catch (error) {
      this.log('Error accessing plugin settings, using default sync settings', error);
    }
    
    // Default to all enabled if settings can't be accessed
    return {
      syncClients: true,
      syncProjects: true,
      syncTasks: true,
      syncTimeEntries: true
    };
  }

  async syncClients() {
    try {
      this.log('Getting clients from API');
      const response = await this.api.getClients();
      this.log('API response for clients', response);
      
      const clientsFolder = this.vault.getClientsFolder();
      this.log('Ensuring clients folder exists', clientsFolder);
      
      try {
        await this.vault.ensureFolder(clientsFolder);
        this.log('Successfully created/verified clients folder', clientsFolder);
      } catch (folderError) {
        this.log('Error creating clients folder', { folder: clientsFolder, error: folderError });
        throw folderError;
      }

      if (!response.items || response.items.length === 0) {
        this.log('No clients found in API response', response);
        NotificationService.showWarning('No clients found in Scoro');
        return;
      }

      // Log the first client to debug the structure
      if (response.items.length > 0) {
        this.log('First client example:', response.items[0]);
      }

      // Modified validation logic to handle clients with 'name' field
      // Cast to any to access potentially undefined properties more safely
      const validClients = response.items.map(client => {
        const anyClient = client as any;
        // Add name property to standard fields for validation
        return {
          ...anyClient,
          // Ensure these fields exist for compatibility
          company_name: anyClient.company_name || anyClient.name || "",
          contact_name: anyClient.contact_name || anyClient.name || "",
          company_id: anyClient.company_id || anyClient.contact_id || "",
          contact_id: anyClient.contact_id || anyClient.company_id || ""
        };
      }).filter(client => client.company_name || client.contact_name || client.name);
      
      // Log count of clients with missing names for debugging
      const invalidClients = response.items.filter(client => {
        const anyClient = client as any;
        return !anyClient.company_name && !anyClient.contact_name && !anyClient.name;
      });
      
      this.log(`Found ${validClients.length} valid clients, ${invalidClients.length} invalid clients`);
      
      if (invalidClients.length > 0) {
        this.log('Clients with missing names', invalidClients);
      }

      this.log(`Processing ${validClients.length} clients`);
      for (const client of validClients) {
        // Client data has already been normalized in our map function above
        const clientName = client.company_name || client.contact_name || client.name;
        const clientId = client.company_id || client.contact_id;
        
        this.log('Processing client', { id: clientId, name: clientName });
        
        // Skip clients without a valid name
        if (!clientName) {
          this.log('Skipping client with missing name', client);
          continue;
        }
        
        const clientFolder = this.vault.getClientFolderPath(clientName);
        this.log('Ensuring client folder exists', clientFolder);
        
        try {
          await this.vault.ensureFolder(clientFolder);
          this.log('Successfully created/verified client folder', clientFolder);
        } catch (folderError) {
          this.log('Error creating client folder', { folder: clientFolder, error: folderError });
          continue;
        }
        
        // Create the projects folder within the client folder
        const projectsFolderPath = `${clientFolder}/${this.vault.getProjectsFolderName()}`;
        this.log('Ensuring projects folder exists', projectsFolderPath);
        
        try {
          await this.vault.ensureFolder(projectsFolderPath);
          this.log('Successfully created/verified projects folder', projectsFolderPath);
        } catch (folderError) {
          this.log('Error creating projects folder', { folder: projectsFolderPath, error: folderError });
          continue;
        }

        this.log('Creating client note');
        
        try {
          const clientNote = this.createClientNote(client);
          // Use the vault service's sanitized client folder path to get the proper path
          const sanitizedClientName = clientFolder.split('/').pop();
          const clientNotePath = `${clientFolder}/${sanitizedClientName}.md`;
          this.log('Saving client note', { path: clientNotePath });
          await this.vault.createOrUpdateNote(clientNotePath, clientNote);
          this.log('Successfully created/updated client note', clientNotePath);
        } catch (noteError) {
          this.log('Error creating client note', { client: clientName, error: noteError });
          continue;
        }
      }
      this.log('All clients processed successfully');
      NotificationService.showSuccess('Clients synced');
    } catch (error) {
      this.log('Failed to sync clients', error);
      NotificationService.showError('Failed to sync clients', error);
      throw error;
    }
  }

  async syncProjects() {
    try {
      this.log('Getting projects from API');
      const response = await this.api.getProjects();
      this.log('API response for projects', response);
      
      // Check if we have projects data in the response
      // Projects could be in response.items or directly in the response array
      const projects = response.items && response.items.length > 0 
        ? response.items 
        : (Array.isArray(response) ? response : []);
      
      if (projects.length === 0) {
        this.log('No projects found in API response', response);
        NotificationService.showWarning('No projects found in Scoro');
        return;
      }
      
      // Get company information to match company_id to company_name
      const clientResponse = await this.api.getClients();
      const clients = clientResponse.items || [];
      const clientsMap = new Map();
      for (const client of clients) {
        // Store both company_id and contact_id in our map for lookup
        if (client.company_id) {
          // Type cast to access potentially missing properties
          const anyClient = client as any;
          clientsMap.set(client.company_id, anyClient.company_name || anyClient.name);
        }
        if (client.contact_id) {
          // Type cast to access potentially missing properties
          const anyClient = client as any;
          clientsMap.set(client.contact_id, anyClient.contact_name || anyClient.name);
        }
      }
      this.log('Created clients map for company name lookup', { mapSize: clientsMap.size });

      this.log(`Processing ${projects.length} projects`);
      for (const project of projects) {
        this.log('Processing project', project);
        
        // Get company name from project directly or lookup by ID
        let companyName = project.company_name;
        if (!companyName && project.company_id) {
          companyName = clientsMap.get(project.company_id);
          this.log('Looked up company name from ID', { id: project.company_id, name: companyName });
        }
        
        const rawProjectName = project.project_name || project.name || '';
        // Sanitize project name by combining all segments
        const projectName = rawProjectName.split(/[/\\]/).join(' ');
        
        // Skip projects with missing required properties
        if (!companyName || !projectName) {
          this.log('Skipping project with missing required properties', project);
          console.warn('Skipping project with missing required properties', project);
          continue;
        }
        
        // Check if client folder exists
        const clientFolder = this.vault.getClientFolderPath(companyName);
        const clientFolderExists = await this.vault.folderExists(clientFolder);
        
        if (!clientFolderExists) {
          this.log('Client folder does not exist, skipping project', { client: companyName, project: projectName });
          NotificationService.showWarning(`Client folder for "${companyName}" not found. Please sync clients first.`);
          continue;
        }
        
        // Then create the project folder using the sanitized project name
        const projectFolder = this.vault.getProjectFolderPath(
          companyName, 
          projectName
        );
        
        this.log('Ensuring project folder exists', projectFolder);
        await this.vault.ensureFolder(projectFolder);
        
        // Create the tasks folder within the project folder using the sanitized project name
        const tasksFolderPath = this.vault.getTasksFolderPath(
          companyName, 
          projectName
        );
        this.log('Ensuring tasks folder exists', tasksFolderPath);
        await this.vault.ensureFolder(tasksFolderPath);

        this.log('Creating project note');
        const projectNote = this.createProjectNote({
          ...project,
          project_name: projectName // Use sanitized project name
        });
        const projectNotePath = `${projectFolder}/${projectName}.md`;
        this.log('Saving project note', { path: projectNotePath, content: projectNote });
        await this.vault.createOrUpdateNote(projectNotePath, projectNote);
      }
      this.log('All projects processed successfully');
      NotificationService.showSuccess('Projects synced');
    } catch (error) {
      this.log('Failed to sync projects', error);
      NotificationService.showError('Failed to sync projects', error);
      throw error;
    }
  }

  async syncTasks() {
    try {
      this.log('Getting tasks from API');
      const response = await this.api.getTasks();
      this.log('API response for tasks', response);
      
      if (!response.items || response.items.length === 0) {
        this.log('No tasks found in API response', response);
        NotificationService.showWarning('No tasks found in Scoro');
        return;
      }

      this.log(`Processing ${response.items.length} tasks`);
      for (const task of response.items) {
        this.log('Processing task', task);
        
        if (!task.project_id) {
          this.log('Skipping task with no project ID', task);
          continue;
        }

        this.log(`Getting project info for project ID: ${task.project_id}`);
        const projectInfo = await this.api.getProject(task.project_id);
        this.log('Project info received', projectInfo);
        
        if (!projectInfo) {
          this.log('Could not find project info for task', { task, projectId: task.project_id });
          continue;
        }
        
        // Safe access to properties with possible undefined values
        const companyName = projectInfo.company_name || '';
        const projectName = projectInfo.name || '';
        
        // Skip tasks with missing required properties
        if (!companyName || !projectName || !task.event_name) {
          this.log('Skipping task with missing required properties', { task, projectInfo });
          console.warn('Skipping task with missing required properties', task);
          continue;
        }
        
        const taskPath = this.vault.getTaskPath(
          companyName,
          projectName,
          task.event_name
        );
        this.log('Creating task note', { path: taskPath });
        const taskNote = this.createTaskNote(task);
        
        this.log('Saving task note', { path: taskPath, content: taskNote });
        await this.vault.createOrUpdateNote(taskPath, taskNote);
      }
      this.log('All tasks processed successfully');
      NotificationService.showSuccess('Tasks synced');
    } catch (error) {
      this.log('Failed to sync tasks', error);
      NotificationService.showError('Failed to sync tasks', error);
      throw error;
    }
  }

  async syncTimeEntries() {
    try {
      // Get time entries from Scoro for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      this.log('Getting time entries from API', { fromDate: thirtyDaysAgo.toISOString(), toDate: new Date().toISOString() });
      const scoroEntries = await this.api.getTimeEntries({
        from_date: thirtyDaysAgo.toISOString(),
        to_date: new Date().toISOString()
      });
      this.log('API response for time entries', scoroEntries);

      // Check if response has expected structure with items
      if (!scoroEntries.items || !Array.isArray(scoroEntries.items)) {
        this.log('Invalid API response format for time entries', scoroEntries);
        NotificationService.showError('Invalid API response format for time entries', 
          new ScoroSyncError('Invalid API response format', 'time entries', scoroEntries)
        );
        throw new ScoroSyncError('Invalid API response format: Expected items array', 'time entries', scoroEntries);
      }

      // Get time entries from daily notes
      this.log('Getting time entries from daily notes', { fromDate: thirtyDaysAgo, toDate: new Date() });
      const dailyNoteEntries = await this.vault.parseTimeEntriesFromDailyNotes(
        thirtyDaysAgo,
        new Date()
      );
      this.log('Daily note entries found', dailyNoteEntries);

      // Create maps for easier lookup
      const scoroEntriesMap = new Map<string, ScoroTimeEntry>();
      const dailyNoteEntriesMap = new Map<string, DailyNoteTimeEntry>();

      for (const entry of scoroEntries.items) {
        scoroEntriesMap.set(entry.time_entry_id, entry);
      }

      for (const entry of dailyNoteEntries) {
        if (entry.time_entry_id) {
          dailyNoteEntriesMap.set(entry.time_entry_id, entry);
        }
      }

      this.log('Entry maps created', { 
        scoroEntries: scoroEntriesMap.size, 
        dailyNoteEntries: dailyNoteEntriesMap.size 
      });

      // Process entries from daily notes
      this.log(`Processing ${dailyNoteEntries.length} entries from daily notes`);
      for (const entry of dailyNoteEntries) {
        this.log('Processing daily note entry', entry);
        
        try {
          if (!entry.task_id) {
            this.log('No task ID found for entry', entry);
            NotificationService.showWarning(
              `No task ID found for entry: ${entry.task_name}. Please link the task first.`
            );
            continue;
          }

          if (!entry.time_entry_id) {
            this.log('Creating new entry in Scoro', entry);
            // Create new entry in Scoro
            const result = await this.api.createTimeEntry({
              event_id: entry.task_id,
              datetime_start: entry.datetime_start,
              datetime_end: entry.datetime_end,
              description: entry.description
            });
            this.log('New entry created in Scoro', result);

            // Update note with time entry ID
            this.log('Updating note with time entry ID', { entryId: result.time_entry_id, path: entry.file_path });
            const updatedContent = await this.addTimeEntryIdToNote(entry, result.time_entry_id);
            if (updatedContent) {
              await this.vault.createOrUpdateNote(entry.file_path, updatedContent);
              this.log('Note updated with time entry ID', { path: entry.file_path });
              NotificationService.showSuccess(`Created time entry for: ${entry.task_name}`);
            } else {
              this.log('Failed to update note with time entry ID', { path: entry.file_path });
            }
          } else {
            // Check if entry exists in Scoro
            const scoroEntry = scoroEntriesMap.get(entry.time_entry_id);
            if (!scoroEntry) {
              this.log('Entry was deleted in Scoro, recreating', entry);
              // Entry was deleted in Scoro, recreate it
              const result = await this.api.createTimeEntry({
                event_id: entry.task_id,
                datetime_start: entry.datetime_start,
                datetime_end: entry.datetime_end,
                description: entry.description
              });
              this.log('Entry recreated in Scoro', result);

              // Update note with new time entry ID
              this.log('Updating note with new time entry ID', { entryId: result.time_entry_id, path: entry.file_path });
              const updatedContent = await this.addTimeEntryIdToNote(entry, result.time_entry_id);
              if (updatedContent) {
                await this.vault.createOrUpdateNote(entry.file_path, updatedContent);
                this.log('Note updated with new time entry ID', { path: entry.file_path });
                NotificationService.showSuccess(`Recreated deleted time entry for: ${entry.task_name}`);
              } else {
                this.log('Failed to update note with new time entry ID', { path: entry.file_path });
              }
            } else {
              // Check if entry needs updating
              const needsUpdate = 
                entry.datetime_start !== scoroEntry.datetime_start ||
                entry.datetime_end !== scoroEntry.datetime_end ||
                entry.description !== scoroEntry.description;

              if (needsUpdate) {
                this.log('Updating entry in Scoro', { 
                  entryId: entry.time_entry_id, 
                  changes: {
                    datetime_start: entry.datetime_start,
                    datetime_end: entry.datetime_end,
                    description: entry.description
                  }
                });
                await this.api.updateTimeEntry(entry.time_entry_id, {
                  datetime_start: entry.datetime_start,
                  datetime_end: entry.datetime_end,
                  description: entry.description
                });
                this.log('Entry updated in Scoro', { entryId: entry.time_entry_id });
                NotificationService.showSuccess(`Updated time entry for: ${entry.task_name}`);
              } else {
                this.log('Entry is already up to date, no changes needed', { entryId: entry.time_entry_id });
              }
            }
          }
        } catch (error) {
          this.log('Error processing daily note entry', { entry, error });
          if (error instanceof ScoroValidationError) {
            NotificationService.showWarning(
              `Invalid time entry data for: ${entry.task_name}`,
              error
            );
          } else {
            NotificationService.showError(
              `Failed to sync time entry: ${entry.task_name}`,
              error
            );
          }
        }
      }

      // Process entries from Scoro that don't exist in daily notes
      this.log(`Processing ${scoroEntriesMap.size} entries from Scoro`);
      for (const [timeEntryId, scoroEntry] of scoroEntriesMap) {
        this.log('Checking if Scoro entry exists in daily notes', { timeEntryId });
        if (!dailyNoteEntriesMap.has(timeEntryId)) {
          this.log('Scoro entry not found in daily notes, adding to notes', { timeEntryId, entry: scoroEntry });
          try {
            // Get task details
            this.log('Getting task details', { eventId: scoroEntry.event_id });
            const task = await this.api.getTask(scoroEntry.event_id);
            if (!task) {
              this.log('Could not find task for Scoro time entry', { timeEntryId, eventId: scoroEntry.event_id });
              NotificationService.showWarning(
                `Could not find task for Scoro time entry: ${timeEntryId}`
              );
              continue;
            }
            this.log('Task details retrieved', task);

            // Create entry in daily note
            const date = new Date(scoroEntry.datetime_start);
            const dailyNotePath = this.vault.getDailyNotePath(date);
            this.log('Creating time entry content for daily note', { 
              date, 
              path: dailyNotePath,
              taskName: task.event_name
            });
            const timeEntryContent = this.createTimeEntryContent(
              task.event_name,
              scoroEntry.datetime_start,
              scoroEntry.datetime_end,
              scoroEntry.description,
              task.task_id,
              timeEntryId
            );

            this.log('Appending time entry to daily note', { path: dailyNotePath, content: timeEntryContent });
            await this.vault.appendToDailyNote(dailyNotePath, timeEntryContent);
            this.log('Time entry appended to daily note', { path: dailyNotePath });
            NotificationService.showSuccess(
              `Added Scoro time entry to daily note: ${task.event_name}`
            );
          } catch (error) {
            this.log('Failed to sync time entry from Scoro', { timeEntryId, error });
            NotificationService.showError(
              `Failed to sync time entry: ${scoroEntry.event_id}`,
              error
            );
          }
        } else {
          this.log('Scoro entry already exists in daily notes, skipping', { timeEntryId });
        }
      }
      
      this.log('All time entries processed successfully');
      NotificationService.showSuccess('Time entries synced');
    } catch (error) {
      this.log('Failed to sync time entries', error);
      NotificationService.showError('Failed to sync time entries', error);
      throw error;
    }
  }

  // Helper methods for creating notes
  private createClientNote(client: any): string {
    this.log('Creating client note for', client);
    const clientName = client.company_name || client.contact_name || client.name;
    const clientId = client.company_id || client.contact_id;
    const clientType = client.company_type || client.contact_type;
    
    this.log(`Client note data: name=${clientName}, id=${clientId}, type=${clientType}`);
    
    return `---
client_id: ${clientId || ''}
client_name: ${clientName || ''}
client_type: ${clientType || ''}
email: ${client.email || ''}
phone: ${client.phone || ''}
website: ${client.website || ''}
address_street: ${client.address?.street || ''}
address_city: ${client.address?.city || ''}
address_state: ${client.address?.state || ''}
address_postal_code: ${client.address?.postal_code || ''}
address_country: ${client.address?.country || ''}
last_synced: ${new Date().toISOString()}
---

## Projects
\`\`\`dataview
TABLE status, deadline as "Due Date", manager_id as "Manager"
FROM "${this.vault.getClientsFolder()}/${clientName}/${this.vault.getProjectsFolderName()}"
WHERE file.name = file.folder.name
SORT deadline ASC
\`\`\`
`;
  }
  
  private formatAddress(address: any): string {
    if (!address) return 'No address provided';
    
    return `- Street: ${address.street || 'N/A'}
- City: ${address.city || 'N/A'}
- State: ${address.state || 'N/A'}
- Postal Code: ${address.postal_code || 'N/A'}
- Country: ${address.country || 'N/A'}`;
  }

  private createProjectNote(project: any): string {
    this.log('Creating project note for', project);
    // Sanitize project name for path construction
    const sanitizedProjectName = project.project_name || project.name || '';
    return `---
project_id: ${project.project_id || ''}
project_name: ${sanitizedProjectName}
status: ${project.status || ''}
deadline: ${project.deadline || ''}
manager_id: ${project.manager_id || ''}
last_synced: ${new Date().toISOString()}
---

## Tasks
\`\`\`dataview
TABLE status, datetime_due as "Due Date", related_users as "Assigned To"
FROM "${this.vault.getClientsFolder()}/${project.company_name}/${this.vault.getProjectsFolderName()}/${sanitizedProjectName}/${this.vault.getTasksFolderName()}"
SORT datetime_due ASC
\`\`\`
`;
  }

  private createTaskNote(task: any): string {
    this.log('Creating task note for', task);
    return `---
task_id: ${task.task_id || ''}
event_name: ${task.event_name || ''}
status: ${task.status || ''}
datetime_due: ${task.datetime_due || ''}
related_users: ${JSON.stringify(task.related_users || [])}
is_completed: ${task.is_completed || false}
last_synced: ${new Date().toISOString()}
---

## SCORO_DESCRIPTION
> ${(task.description || 'No description provided.').split('\n').join('\n> ')}

## Time Entries
\`\`\`dataview
TABLE duration, description
FROM "${this.vault.getDailyNotesFolder()}"
WHERE contains(time_entry_task_id, "${task.task_id}")
SORT file.day DESC
\`\`\`
`;
  }

  private createTimeEntryContent(
    taskName: string,
    startTime: string,
    endTime: string,
    description?: string,
    taskId?: string,
    timeEntryId?: string
  ): string {
    this.log('Creating time entry content', { taskName, startTime, endTime, description, taskId, timeEntryId });
    const start = new Date(startTime);
    const end = new Date(endTime);
    const duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    
    return `- [ ] ${taskName} ⏱️ ${this.formatTime(start)} - ${this.formatTime(end)} (${duration}m)${
      description ? ` - ${description}` : ''
    }${taskId ? ` #task-${taskId}` : ''}${timeEntryId ? ` #time-${timeEntryId}` : ''}`;
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  private async addTimeEntryIdToNote(entry: DailyNoteTimeEntry, timeEntryId: string): Promise<string | null> {
    try {
      this.log('Adding time entry ID to note', { entry, timeEntryId });
      const content = await this.vault.readFile(entry.file_path);
      this.log('Read file content', { path: entry.file_path, contentLength: content.length });
      
      const lines = content.split('\n');
      const entryLineIndex = lines.findIndex(line => 
        line.includes(entry.task_name) && 
        line.includes(this.formatTime(new Date(entry.datetime_start))) &&
        !line.includes(`#time-${timeEntryId}`)
      );

      this.log('Found entry line index', { entryLineIndex, line: entryLineIndex !== -1 ? lines[entryLineIndex] : 'not found' });
      
      if (entryLineIndex === -1) {
        this.log('Could not find time entry line in note', { taskName: entry.task_name });
        NotificationService.showWarning(
          `Could not find time entry line in note: ${entry.task_name}`
        );
        return null;
      }

      const line = lines[entryLineIndex];
      lines[entryLineIndex] = line.includes('#time-')
        ? line.replace(/#time-[a-zA-Z0-9]+/, `#time-${timeEntryId}`)
        : `${line} #time-${timeEntryId}`;
      
      this.log('Updated line', { original: line, updated: lines[entryLineIndex] });
      
      return lines.join('\n');
    } catch (error) {
      this.log('Failed to update time entry ID in note', { error, entry });
      NotificationService.showError(
        `Failed to update time entry ID in note: ${entry.file_path}`,
        error
      );
      return null;
    }
  }
}