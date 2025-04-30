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
  constructor(
    private api: ScoroApiService,
    private vault: VaultService
  ) {}

  async syncAll() {
    try {
      NotificationService.showInfo('Starting sync...');
      
      await this.syncClients();
      await this.syncProjects();
      await this.syncTasks();
      await this.syncTimeEntries();
      
      NotificationService.showSuccess('Sync completed successfully');
    } catch (error) {
      NotificationService.showError('Sync failed', error);
      throw error;
    }
  }

  async syncClients() {
    try {
      const response = await this.api.getClients();
      const clientsFolder = 'Clients';
      await this.vault.ensureFolder(clientsFolder);

      for (const client of response.items) {
        const clientFolder = `${clientsFolder}/${client.company_name}`;
        await this.vault.ensureFolder(clientFolder);
        await this.vault.ensureFolder(`${clientFolder}/Projects`);

        const clientNote = this.createClientNote(client);
        await this.vault.createOrUpdateNote(
          `${clientFolder}/Client.md`,
          clientNote
        );
      }
      NotificationService.showSuccess('Clients synced');
    } catch (error) {
      NotificationService.showError('Failed to sync clients', error);
      throw error;
    }
  }

  async syncProjects() {
    try {
      const response = await this.api.getProjects();
      
      for (const project of response.items) {
        const clientFolder = `Clients/${project.company_name}`;
        const projectFolder = `${clientFolder}/Projects/${project.project_name}`;
        
        await this.vault.ensureFolder(projectFolder);
        await this.vault.ensureFolder(`${projectFolder}/Tasks`);

        const projectNote = this.createProjectNote(project);
        await this.vault.createOrUpdateNote(
          `${projectFolder}/Project.md`,
          projectNote
        );
      }
      NotificationService.showSuccess('Projects synced');
    } catch (error) {
      NotificationService.showError('Failed to sync projects', error);
      throw error;
    }
  }

  async syncTasks() {
    try {
      const response = await this.api.getTasks();
      
      for (const task of response.items) {
        if (!task.project_id) continue;

        const projectInfo = await this.api.getProject(task.project_id);
        const taskPath = `Clients/${projectInfo.company_name}/Projects/${projectInfo.project_name}/Tasks/${task.event_name}.md`;
        const taskNote = this.createTaskNote(task);
        
        await this.vault.createOrUpdateNote(taskPath, taskNote);
      }
      NotificationService.showSuccess('Tasks synced');
    } catch (error) {
      NotificationService.showError('Failed to sync tasks', error);
      throw error;
    }
  }

  async syncTimeEntries() {
    try {
      // Get time entries from Scoro for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const scoroEntries = await this.api.getTimeEntries({
        from_date: thirtyDaysAgo.toISOString(),
        to_date: new Date().toISOString()
      });

      // Get time entries from daily notes
      const dailyNoteEntries = await this.vault.parseTimeEntriesFromDailyNotes(
        thirtyDaysAgo,
        new Date()
      );

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

      // Process entries from daily notes
      for (const entry of dailyNoteEntries) {
        try {
          if (!entry.task_id) {
            NotificationService.showWarning(
              `No task ID found for entry: ${entry.task_name}. Please link the task first.`
            );
            continue;
          }

          if (!entry.time_entry_id) {
            // Create new entry in Scoro
            const result = await this.api.createTimeEntry({
              event_id: entry.task_id,
              datetime_start: entry.datetime_start,
              datetime_end: entry.datetime_end,
              description: entry.description
            });

            // Update note with time entry ID
            const updatedContent = await this.addTimeEntryIdToNote(entry, result.time_entry_id);
            if (updatedContent) {
              await this.vault.createOrUpdateNote(entry.file_path, updatedContent);
              NotificationService.showSuccess(`Created time entry for: ${entry.task_name}`);
            }
          } else {
            // Check if entry exists in Scoro
            const scoroEntry = scoroEntriesMap.get(entry.time_entry_id);
            if (!scoroEntry) {
              // Entry was deleted in Scoro, recreate it
              const result = await this.api.createTimeEntry({
                event_id: entry.task_id,
                datetime_start: entry.datetime_start,
                datetime_end: entry.datetime_end,
                description: entry.description
              });

              // Update note with new time entry ID
              const updatedContent = await this.addTimeEntryIdToNote(entry, result.time_entry_id);
              if (updatedContent) {
                await this.vault.createOrUpdateNote(entry.file_path, updatedContent);
                NotificationService.showSuccess(`Recreated deleted time entry for: ${entry.task_name}`);
              }
            } else {
              // Check if entry needs updating
              const needsUpdate = 
                entry.datetime_start !== scoroEntry.datetime_start ||
                entry.datetime_end !== scoroEntry.datetime_end ||
                entry.description !== scoroEntry.description;

              if (needsUpdate) {
                await this.api.updateTimeEntry(entry.time_entry_id, {
                  datetime_start: entry.datetime_start,
                  datetime_end: entry.datetime_end,
                  description: entry.description
                });
                NotificationService.showSuccess(`Updated time entry for: ${entry.task_name}`);
              }
            }
          }
        } catch (error) {
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
      for (const [timeEntryId, scoroEntry] of scoroEntriesMap) {
        if (!dailyNoteEntriesMap.has(timeEntryId)) {
          try {
            // Get task details
            const task = await this.api.getTask(scoroEntry.event_id);
            if (!task) {
              NotificationService.showWarning(
                `Could not find task for Scoro time entry: ${timeEntryId}`
              );
              continue;
            }

            // Create entry in daily note
            const date = new Date(scoroEntry.datetime_start);
            const dailyNotePath = this.vault.getDailyNotePath(date);
            const timeEntryContent = this.createTimeEntryContent(
              task.event_name,
              scoroEntry.datetime_start,
              scoroEntry.datetime_end,
              scoroEntry.description,
              task.task_id,
              timeEntryId
            );

            await this.vault.appendToDailyNote(dailyNotePath, timeEntryContent);
            NotificationService.showSuccess(
              `Added Scoro time entry to daily note: ${task.event_name}`
            );
          } catch (error) {
            NotificationService.showError(
              `Failed to add Scoro time entry to daily note: ${timeEntryId}`,
              error
            );
          }
        }
      }

      NotificationService.showSuccess('Time entries synced successfully');
    } catch (error) {
      throw new ScoroSyncError('Failed to sync time entries', 'time_entries', error);
    }
  }

  private createClientNote(client: any): string {
    return `---
company_id: ${client.company_id}
company_name: ${client.company_name}
company_type: ${client.company_type}
last_synced: ${new Date().toISOString()}
---

# ${client.company_name}

## Contact Information
- Email: ${client.email || 'N/A'}
- Phone: ${client.phone || 'N/A'}
- Website: ${client.website || 'N/A'}

## Address
${this.formatAddress(client.address)}

## Projects
\`\`\`dataview
TABLE status, deadline as "Due Date", manager_id as "Manager"
FROM "Clients/${client.company_name}/Projects"
SORT deadline ASC
\`\`\`
`;
  }

  private createProjectNote(project: any): string {
    return `---
project_id: ${project.project_id}
project_name: ${project.project_name}
status: ${project.status}
deadline: ${project.deadline}
manager_id: ${project.manager_id}
last_synced: ${new Date().toISOString()}
---

# ${project.project_name}

## Tasks
\`\`\`dataview
TABLE status, datetime_due as "Due Date", related_users as "Assigned To"
FROM "Clients/${project.company_name}/Projects/${project.project_name}/Tasks"
SORT datetime_due ASC
\`\`\`
`;
  }

  private createTaskNote(task: any): string {
    return `---
task_id: ${task.task_id}
event_name: ${task.event_name}
status: ${task.status}
datetime_due: ${task.datetime_due}
related_users: ${JSON.stringify(task.related_users)}
is_completed: ${task.is_completed}
last_synced: ${new Date().toISOString()}
---

# ${task.event_name}

${task.description || ''}

## Time Entries
\`\`\`dataview
TABLE duration, description
FROM "Daily"
WHERE contains(time_entry_task_id, "${task.task_id}")
SORT file.day DESC
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

  private createTimeEntryContent(
    taskName: string,
    startTime: string,
    endTime: string,
    description?: string,
    taskId?: string,
    timeEntryId?: string
  ): string {
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
      const content = await this.vault.readFile(entry.file_path);
      const lines = content.split('\n');
      const entryLineIndex = lines.findIndex(line => 
        line.includes(entry.task_name) && 
        line.includes(this.formatTime(new Date(entry.datetime_start))) &&
        !line.includes(`#time-${timeEntryId}`)
      );

      if (entryLineIndex === -1) {
        NotificationService.showWarning(
          `Could not find time entry line in note: ${entry.task_name}`
        );
        return null;
      }

      const line = lines[entryLineIndex];
      lines[entryLineIndex] = line.includes('#time-')
        ? line.replace(/#time-[a-zA-Z0-9]+/, `#time-${timeEntryId}`)
        : `${line} #time-${timeEntryId}`;

      return lines.join('\n');
    } catch (error) {
      NotificationService.showError(
        `Failed to update time entry ID in note: ${entry.file_path}`,
        error
      );
      return null;
    }
  }
} 