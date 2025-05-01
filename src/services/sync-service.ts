import { ScoroApiService } from './scoro-api';
import { VaultService } from './vault-service';
import { NotificationService, ScoroValidationError, ScoroSyncError } from '../utils/notifications';
import { SanitizationService } from './sanitization-service';
import {
  ScoroClient,
  ScoroProject,
  ScoroTask,
  ScoroTimeEntry,
  DailyNoteTimeEntry,
  ScoroListResponse
} from '../types/scoro';

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

  /**
   * Syncs clients from Scoro to Obsidian
   */
  private async syncClients() {
    try {
      // Get clients from API
      const response = await this.api.getClients();
      
      // Process each client
      for (const client of response.items || []) {
        await this.processClient(client);
      }
    } catch (error) {
      this.log('Failed to sync clients', error);
      NotificationService.showError('Failed to sync clients', error);
      throw error;
    }
  }

  /**
   * Syncs projects from Scoro to Obsidian
   */
  private async syncProjects() {
    try {
      let allProjects: ScoroProject[] = [];
      let currentPage = 1;
      let hasMorePages = true;
      const perPage = 25; // Using smaller page size since we're using detailed_response
      
      this.log('Starting project sync with pagination');
      
      while (hasMorePages) {
        this.log('Fetching projects page', { page: currentPage });
        
        // Get projects from API with pagination and detailed response
        const response = await this.api.getProjects({
          page: currentPage,
          per_page: perPage
        });
        
        this.log('Projects API response', { 
          status: response.status,
          itemCount: response.items?.length || 0,
          hasMore: response.has_more
        });
        
        // Add projects from this page to our collection
        if (response.items && response.items.length > 0) {
          allProjects = allProjects.concat(response.items);
        }
        
        // Check if we have more pages
        if (!response.has_more) {
          hasMorePages = false;
        } else {
          currentPage++;
          // Add a small delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      this.log(`Total projects found: ${allProjects.length}`);
      
      // Process each project and its tasks
      for (const project of allProjects) {
        this.log('Processing project', { 
          id: project.project_id,
          name: project.project_name,
          company: project.company_name
        });
        
        // First process the project itself
        await this.processProject(project);
        
        // Then, if task sync is enabled and we're syncing projects, sync tasks for this project
        if (this.getSyncSettings().syncTasks && this.getSyncSettings().syncProjects) {
          await this.syncProjectTasks(project);
        }
      }
    } catch (error) {
      this.log('Failed to sync projects', error);
      NotificationService.showError('Failed to sync projects', error);
      throw error;
    }
  }

  /**
   * Syncs tasks for a specific project
   */
  private async syncProjectTasks(project: ScoroProject) {
    try {
      let allTasks: ScoroTask[] = [];
      let currentPage = 1;
      let hasMorePages = true;
      const perPage = 25; // Using smaller page size since we're using detailed_response
      
      this.log('Starting task sync for project', { 
        projectId: project.project_id, 
        projectName: project.project_name 
      });
      
      while (hasMorePages) {
        this.log('Fetching tasks page', { page: currentPage });
        
        // Get tasks from API with pagination, detailed response, and project filter
        const response = await this.api.getTasks({
          page: currentPage,
          per_page: perPage,
          filter: {
            project_id: project.project_id
          }
        });
        
        this.log('Tasks API response', { 
          status: response.status,
          itemCount: response.items?.length || 0,
          hasMore: response.has_more
        });
        
        // Add tasks from this page to our collection
        if (response.items && response.items.length > 0) {
          allTasks = allTasks.concat(response.items);
        }
        
        // Check if we have more pages
        if (!response.has_more) {
          hasMorePages = false;
        } else {
          currentPage++;
          // Add a small delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      this.log(`Total tasks found for project: ${allTasks.length}`);
      
      // Process each task
      for (const task of allTasks) {
        try {
          await this.processTask(project, task);
        } catch (taskError) {
          this.log('Failed to process task', {
            taskId: task.event_id,
            taskName: task.event_name,
            error: taskError
          });
          // Continue with next task even if one fails
          continue;
        }
      }
    } catch (error) {
      this.log('Failed to sync tasks for project', { 
        projectId: project.project_id, 
        error 
      });
      NotificationService.showError('Failed to sync tasks for project', error);
      throw error;
    }
  }

  /**
   * Syncs tasks from Scoro to Obsidian
   */
  private async syncTasks() {
    try {
      // Create data structures to organize tasks
      const tasksByProject = new Map<string, any[]>();
      const unassignedTasks: any[] = [];
      let allTasksProcessed = false;
      let page = 1;
      let totalTasks = 0;

      // Step 1: Get all tasks from Scoro API with pagination
      while (!allTasksProcessed) {
        this.log('Getting tasks from API', { page });
        const response = await this.api.getTasks({
          page: page,
          per_page: 100 // Standard page size
        });
        this.log('API response for tasks', { 
          page,
          itemCount: response.items?.length || 0,
          hasMore: response.has_more
        });
        
        // Check if we have tasks in this page
        if (!response.items || response.items.length === 0) {
          this.log('No tasks found in API response', response);
          if (page === 1) {
            NotificationService.showWarning('No tasks found in Scoro');
            return;
          }
          break;
        }
        
        // Process tasks in this page
        for (const task of response.items) {
          if (task.project_id) {
            // Add task to project's task list
            const projectTasks = tasksByProject.get(task.project_id) || [];
            projectTasks.push(task);
            tasksByProject.set(task.project_id, projectTasks);
          } else {
            // Add to unassigned tasks
            unassignedTasks.push(task);
          }
          totalTasks++;
        }
        
        // Check if we have more pages
        if (!response.has_more) {
          allTasksProcessed = true;
        } else {
          page++;
        }
      }

      // Step 2: Process tasks by project
      for (const [projectId, tasks] of tasksByProject) {
        await this.processProjectTasks(projectId, tasks);
      }
      
      // Step 3: Process unassigned tasks
      if (unassignedTasks.length > 0) {
        await this.processUnassignedTasks(unassignedTasks);
      }
      
      this.log(`Processed ${totalTasks} tasks`);
    } catch (error) {
      this.log('Failed to sync tasks', error);
      NotificationService.showError('Failed to sync tasks', error);
      throw error;
    }
  }

  /**
   * Syncs time entries from Scoro to Obsidian
   */
  private async syncTimeEntries() {
    try {
      // Get time entries from API
      const response = await this.api.getTimeEntries();
      
      // Process each time entry
      for (const entry of response.items || []) {
        await this.processTimeEntry(entry);
      }
    } catch (error) {
      this.log('Failed to sync time entries', error);
      NotificationService.showError('Failed to sync time entries', error);
      throw error;
    }
  }

  /**
   * Process a single client from Scoro
   */
  private async processClient(client: ScoroClient) {
    const clientName = SanitizationService.sanitizeName(
      client.company_name || client.contact_name || (client as any).name
    );
    const clientId = client.company_id || client.contact_id;
    
    this.log('Processing client', { id: clientId, name: clientName });
    
    // Skip clients without a valid name
    if (!clientName) {
      this.log('Skipping client with missing name', client);
      return;
    }

    // Try to find existing client note by client_id
    const existingClientNotes = await this.vault.findNotesByFrontmatter({
      type: 'scoro_client',
      client_id: clientId
    });

    if (existingClientNotes.length > 0) {
      // Update existing note
      const clientNote = this.createClientNote(client);
      await this.vault.createOrUpdateNote(existingClientNotes[0], clientNote);
      this.log('Updated existing client note', existingClientNotes[0]);
      return;
    }
    
    // No existing note found, create new one
    const clientFolder = this.vault.getClientFolderPath(clientName);
    this.log('Ensuring client folder exists', clientFolder);
    
    try {
      await this.vault.ensureFolder(clientFolder);
      this.log('Successfully created/verified client folder', clientFolder);
    } catch (folderError) {
      this.log('Error creating client folder', { folder: clientFolder, error: folderError });
      return;
    }
    
    // Create the projects folder within the client folder
    const projectsFolderPath = `${clientFolder}/${this.vault.getProjectsFolderName()}`;
    this.log('Ensuring projects folder exists', projectsFolderPath);
    
    try {
      await this.vault.ensureFolder(projectsFolderPath);
      this.log('Successfully created/verified projects folder', projectsFolderPath);
    } catch (folderError) {
      this.log('Error creating projects folder', { folder: projectsFolderPath, error: folderError });
      return;
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
      return;
    }
  }

  /**
   * Process a single project from Scoro
   */
  private async processProject(project: ScoroProject) {
    // Try to find existing project note by project_id
    const existingProjectNotes = await this.vault.findNotesByFrontmatter({
      type: 'scoro_project',
      project_id: project.project_id
    });

    if (existingProjectNotes.length > 0) {
      // Update existing note
      const projectNote = this.createProjectNote(project);
      await this.vault.createOrUpdateNote(existingProjectNotes[0], projectNote);
      this.log('Updated existing project note', existingProjectNotes[0]);
      return;
    }

    // Get company name from project directly or lookup by ID
    let companyName = SanitizationService.sanitizeName(project.company_name || '');
    if (!companyName && project.company_id) {
      const clientResponse = await this.api.getClients();
      const clients = clientResponse.items || [];
      for (const client of clients) {
        if (client.company_id === project.company_id) {
          companyName = SanitizationService.sanitizeName(client.company_name || (client as any).name || '');
          break;
        }
      }
    }
    
    const rawProjectName = project.project_name || (project as any).name || '';
    // Sanitize project name
    const projectName = SanitizationService.sanitizeName(rawProjectName);
    
    // Skip projects with missing required properties
    if (!companyName || !projectName) {
      this.log('Skipping project with missing required properties', project);
      console.warn('Skipping project with missing required properties', project);
      return;
    }
    
    // Check if client folder exists
    const clientFolder = this.vault.getClientFolderPath(companyName);
    const clientFolderExists = await this.vault.folderExists(clientFolder);
    
    if (!clientFolderExists) {
      this.log('Client folder does not exist, skipping project', { client: companyName, project: projectName });
      NotificationService.showWarning(`Client folder for "${companyName}" not found. Please sync clients first.`);
      return;
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
    } as ScoroProject);
    const projectNotePath = `${projectFolder}/${projectName}.md`;
    this.log('Saving project note', { path: projectNotePath, content: projectNote });
    await this.vault.createOrUpdateNote(projectNotePath, projectNote);
  }

  /**
   * Process tasks for a specific project
   */
  private async processProjectTasks(projectId: string, tasks: ScoroTask[]) {
    // Find project in our existing projects list
    const project = tasks[0]; // We can use the project info from any task since they all have the same project info
    if (!project) {
      this.log('No tasks found for project', { projectId });
      return;
    }

    const companyName = project.company_name || 'Unnamed Company';
    const projectName = project.project_name || 'Unnamed Project';

    // Ensure project structure exists
    const clientFolder = this.vault.getClientFolderPath(companyName);
    const projectFolder = this.vault.getProjectFolderPath(companyName, projectName);
    const tasksFolder = this.vault.getTasksFolderPath(companyName, projectName);

    try {
      // Create folder structure if it doesn't exist
      await this.vault.ensureFolder(clientFolder);
      await this.vault.ensureFolder(projectFolder);
      await this.vault.ensureFolder(tasksFolder);
    } catch (error) {
      this.log('Failed to create folder structure', { error });
      throw error;
    }

    // Process each task
    for (const task of tasks) {
      // Try to find existing task note by task_id
      const existingTaskNotes = await this.vault.findNotesByFrontmatter({
        type: 'scoro_task',
        task_id: task.event_id
      });

      if (existingTaskNotes.length > 0) {
        // Update existing note
        const taskNote = this.createTaskNote(task);
        await this.vault.createOrUpdateNote(existingTaskNotes[0], taskNote);
        this.log('Updated existing task note', existingTaskNotes[0]);
        continue;
      }

      // No existing note found, create new one
      const taskPath = this.vault.getTaskPath(
        companyName,
        projectName,
        task.event_name
      );
      const taskNote = this.createTaskNote(task);
      await this.vault.createOrUpdateNote(taskPath, taskNote);
    }
  }

  /**
   * Process unassigned tasks
   */
  private async processUnassignedTasks(tasks: ScoroTask[]) {
    this.log('Processing unassigned tasks', { count: tasks.length });
    const unassignedFolder = this.vault.getUnassignedTasksFolder();
    await this.vault.ensureFolder(unassignedFolder);

    for (const task of tasks) {
      const taskPath = this.vault.getUnassignedTaskPath(task.event_name);
      const taskNote = this.createTaskNote({
        ...task,
        project_name: 'Unassigned',
        company_name: 'Unassigned'
      });
      await this.vault.createOrUpdateNote(taskPath, taskNote);
    }
  }

  /**
   * Process a single time entry from Scoro
   */
  private async processTimeEntry(entry: ScoroTimeEntry) {
    try {
      // Get task details
      const task = await this.api.getTask(entry.event_id);
      if (!task) {
        this.log('Could not find task for time entry', { timeEntryId: entry.time_entry_id, eventId: entry.event_id });
        NotificationService.showWarning(
          `Could not find task for time entry: ${entry.time_entry_id}`
        );
        return;
      }

      // Create entry in daily note
      const date = new Date(entry.datetime_start);
      const dailyNotePath = this.vault.getDailyNotePath(date);
      const timeEntryContent = this.createTimeEntryContent(
        task.event_name,
        entry.datetime_start,
        entry.datetime_end,
        entry.description,
        task.task_id,
        entry.time_entry_id
      );

      await this.vault.appendToDailyNote(dailyNotePath, timeEntryContent);
      NotificationService.showSuccess(
        `Added time entry to daily note: ${task.event_name}`
      );
    } catch (error) {
      this.log('Failed to process time entry', { timeEntryId: entry.time_entry_id, error });
      NotificationService.showError(
        `Failed to process time entry: ${entry.event_id}`,
        error
      );
    }
  }

  /**
   * Process a single task from Scoro
   */
  private async processTask(project: ScoroProject, task: ScoroTask) {
    try {
      if (!task.event_id) {
        this.log('Task has no ID, skipping', {
          taskName: task.event_name
        });
        return;
      }

      // Get detailed task information
      const taskResponse = await this.api.getTaskView(task.event_id);
      const detailedTask = {
        ...task,
        ...taskResponse,
        project_name: SanitizationService.sanitizeName(project.project_name || ''),
        company_name: SanitizationService.sanitizeName(project.company_name || '')
      };

      // Get the task path using sanitized names
      const taskPath = this.vault.getTaskPath(
        SanitizationService.sanitizeName(project.company_name || 'Unknown Company'),
        SanitizationService.sanitizeName(project.project_name || ''),
        SanitizationService.sanitizeName(task.event_name || '')
      );

      // Create or update the task note
      const taskNote = this.createTaskNote(detailedTask);
      await this.vault.createOrUpdateNote(taskPath, taskNote);
      
      this.log('Successfully processed task', {
        taskId: task.event_id,
        taskName: task.event_name,
        path: taskPath
      });
    } catch (error) {
      this.log('Failed to process task', {
        taskId: task.event_id,
        taskName: task.event_name,
        error
      });
      NotificationService.showWarning(`Failed to process task: ${task.event_name}`);
    }
  }

  // Helper methods for creating notes
  private createClientNote(client: ScoroClient): string {
    this.log('Creating client note for', client);
    const clientName = SanitizationService.sanitizeName(
      client.company_name || client.contact_name || client.name
    );
    const clientId = client.company_id || client.contact_id;
    const clientType = client.company_type || client.contact_type;
    
    this.log(`Client note data: name=${clientName}, id=${clientId}, type=${clientType}`);
    
    return `---
type: scoro_client
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

  private createProjectNote(project: ScoroProject): string {
    this.log('Creating project note for', project);
    // Sanitize project name for path construction
    const sanitizedProjectName = SanitizationService.sanitizeName(project.project_name);
    return `---
type: scoro_project
project_id: ${project.project_id || ''}
project_name: ${sanitizedProjectName}
status: ${project.status_name || ''}
deadline: ${project.deadline_date || ''}
manager_id: ${project.manager_id || ''}
last_synced: ${new Date().toISOString()}
---

## Tasks
\`\`\`dataview
TABLE status, datetime_due as "Due Date", related_users as "Assigned To"
FROM "${this.vault.getClientsFolder()}/${SanitizationService.sanitizeName(project.company_name)}/${this.vault.getProjectsFolderName()}/${sanitizedProjectName}/${this.vault.getTasksFolderName()}"
SORT datetime_due ASC
\`\`\`
`;
  }

  private createTaskNote(task: ScoroTask): string {
    this.log('Creating task note for', task);
    const sanitizedProjectName = SanitizationService.sanitizeName(task.project_name || 'Unassigned');
    const sanitizedCompanyName = SanitizationService.sanitizeName(task.company_name || 'Unassigned');
    const sanitizedEventName = SanitizationService.sanitizeName(task.event_name || '');
    
    return `---
type: scoro_task
task_id: ${task.event_id || ''}
event_id: ${task.event_id || ''}
event_name: ${sanitizedEventName}
project_id: ${task.project_id || ''}
project_name: "[[${sanitizedProjectName}]]"
company_id: ${task.company_id || ''}
company_name: "[[${sanitizedCompanyName}]]"
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
WHERE contains(time_entry_task_id, "${task.event_id}")
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