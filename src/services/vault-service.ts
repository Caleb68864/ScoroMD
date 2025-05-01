import { App, TFile, Vault, Modal } from 'obsidian';
import { NotificationService } from '../utils/notifications';
import { DailyNoteTimeEntry } from '../models/scoro-types';
import { SanitizationService } from './sanitization-service';

/**
 * Modal dialog for presenting choices to the user
 * This is used instead of importing ChoiceModal
 */
class SimpleChoiceModal extends Modal {
  constructor(
    app: App, 
    private message: string, 
    private options: string[], 
    private onChoose: (choice: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Make a choice' });
    contentEl.createEl('p', { text: this.message });
    
    const buttonContainer = contentEl.createDiv({ cls: 'choice-buttons' });
    
    this.options.forEach(option => {
      const button = buttonContainer.createEl('button', { text: option });
      button.addEventListener('click', () => {
        this.onChoose(option);
        this.close();
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class VaultService {
  private dailyNotesFolder: string = 'Daily';
  private dailyNotesFormat: string = 'YYYY-MM-DD'; // Default format
  private clientsFolder: string = 'Clients';
  private projectsFolderName: string = 'Projects';
  private tasksFolderName: string = 'Tasks';
  private unassignedTasksFolder: string = 'Unassigned Tasks';
  private app: App;
  private settings: any;
  private developerMode: boolean = false;

  constructor(app: App) {
    this.app = app;
    // Get settings from the plugin
    this.settings = (app as any).plugins.plugins['scoro-md']?.settings || {};
    
    // Set developer mode
    this.developerMode = this.settings.developerMode || false;

    // Get the settings if available
    try {
      const plugin = (this.app as any).plugins?.plugins['scoro-md'];
      if (plugin && plugin.settings) {
        // Get daily notes folder
        if (plugin.settings.dailyNotesFolder) {
          this.dailyNotesFolder = plugin.settings.dailyNotesFolder;
        }
        
        // Get daily notes format if available
        if (plugin.settings.dailyNotesFormat) {
          this.dailyNotesFormat = plugin.settings.dailyNotesFormat;
        } else {
          // If no custom format, try to detect from daily notes plugin
          this.detectDailyNotesFormat();
        }
        
        // Get clients folder
        if (plugin.settings.clientsFolder) {
          this.clientsFolder = plugin.settings.clientsFolder;
        }
        
        // Get projects folder name
        if (plugin.settings.projectsFolderName) {
          this.projectsFolderName = plugin.settings.projectsFolderName;
        }
        
        // Get tasks folder name
        if (plugin.settings.tasksFolderName) {
          this.tasksFolderName = plugin.settings.tasksFolderName;
        }
        
        // Set developer mode
        if (plugin.settings.developerMode !== undefined) {
          this.developerMode = plugin.settings.developerMode;
        }
        
        // Initialize folders
        this.initializeFolders();
      }
    } catch (error) {
      console.error("Could not access plugin settings:", error);
    }
  }

  /**
   * Initialize required folders in the vault
   * This creates the clients folder and other required base folders
   */
  private async initializeFolders() {
    try {
      // Create clients folder if it doesn't exist
      if (this.clientsFolder) {
        this.logDebug(`Ensuring base clients folder exists: ${this.clientsFolder}`);
        this.ensureFolder(this.clientsFolder).catch(error => {
          console.error(`Failed to create clients folder: ${this.clientsFolder}`, error);
        });
      }
      
      // Create daily notes folder if it doesn't exist
      if (this.dailyNotesFolder) {
        this.logDebug(`Ensuring base daily notes folder exists: ${this.dailyNotesFolder}`);
        this.ensureFolder(this.dailyNotesFolder).catch(error => {
          console.error(`Failed to create daily notes folder: ${this.dailyNotesFolder}`, error);
        });
      }
    } catch (error) {
      console.error("Error initializing folders:", error);
    }
  }

  /**
   * Try to detect daily notes format from the daily notes plugin
   */
  private detectDailyNotesFormat(): void {
    try {
      // Try to access the daily notes plugin settings
      const dailyNotesPlugin = (this.app as any).plugins?.plugins['daily-notes'];
      if (dailyNotesPlugin && dailyNotesPlugin.settings) {
        if (dailyNotesPlugin.settings.format) {
          this.dailyNotesFormat = dailyNotesPlugin.settings.format;
          console.log(`Detected daily notes format: ${this.dailyNotesFormat}`);
        }
      }
    } catch (error) {
      console.error("Could not detect daily notes format:", error);
    }
  }

  /**
   * Find an existing daily note for the given date
   * @param date The date to find a note for
   * @returns The path to the existing note, or null if none exists
   */
  async findExistingDailyNote(date: Date): Promise<string | null> {
    try {
      // Try to find the note using current path format
      const currentPath = this.getDailyNotePath(date);
      const exists = await this.app.vault.adapter.exists(currentPath);
      if (exists) {
        return currentPath;
      }

      // If no exact match found and we're using a nested format,
      // try to look for files matching the date in a flatter structure
      const dateStr = this.formatDate(date, this.dailyNotesFormat);
      const dailyNotes = this.app.vault.getMarkdownFiles().filter(file => {
        // Check if the filename matches our date string (ignoring path)
        const fileName = file.basename;
        return fileName === dateStr;
      });

      if (dailyNotes.length > 0) {
        // Found a matching note
        return dailyNotes[0].path;
      }

      return null;
    } catch (error) {
      console.error("Error finding existing daily note:", error);
      return null;
    }
  }

  /**
   * Format a date according to the specified format string
   * Supports common date format patterns like YYYY, MM, DD, etc.
   * @param date The date to format
   * @param format The format string
   * @returns The formatted date string
   */
  private formatDate(date: Date, format: string): string {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    let result = format;
    result = result.replace(/YYYY/g, year);
    result = result.replace(/YY/g, year.substring(2));
    result = result.replace(/MM/g, month);
    result = result.replace(/DD/g, day);
    
    return result;
  }

  /**
   * Sanitizes a value from Scoro for use in paths and filenames.
   * This should be used for all values coming from Scoro before they are used in paths.
   * @param value The value to sanitize
   * @returns Sanitized value safe for use in paths and filenames
   */
  private sanitizeScoro(value: string): string {
    return SanitizationService.sanitizeName(value);
  }

  /**
   * Sanitizes a path or path segment for safe file system usage.
   * This is the main method that should be used for all path sanitization.
   * @param path The path or path segment to sanitize
   * @param options Optional configuration for sanitization
   * @returns Sanitized path
   */
  private sanitizePath(path: string, options: {
    preserveSlashes?: boolean;      // Whether to preserve path separators
  } = {}): string {
    return SanitizationService.sanitizePath(path, options.preserveSlashes);
  }

  /**
   * Sanitizes a folder path, preserving the structure
   * @param path The folder path to sanitize
   * @returns Sanitized path with structure preserved
   */
  private sanitizeFolderPath(path: string): string {
    return SanitizationService.sanitizeFolderPath(path);
  }

  /**
   * Sanitizes a file or folder name (single segment)
   * @param name The name to sanitize
   * @returns Sanitized name
   */
  private sanitizeFileName(name: string): string {
    return SanitizationService.sanitizeFileName(name);
  }

  getDailyNotePath(date: Date): string {
    // Sanitize the daily notes folder path
    const sanitizedFolder = this.sanitizePath(this.dailyNotesFolder, { preserveSlashes: true });
    
    // Format the date according to the format string
    const dateStr = this.formatDate(date, this.dailyNotesFormat);
    
    return `${sanitizedFolder}/${dateStr}.md`;
  }

  async ensureFolder(path: string): Promise<void> {
    try {
      if (this.developerMode) {
        console.log(`[ScoroMD Debug] Ensuring folder exists: ${path}`);
      }
      
      // Sanitize path
      const sanitizedPath = this.sanitizeFolderPath(path);
      
      if (sanitizedPath !== path) {
        console.log(`[ScoroMD Debug] Path sanitized from "${path}" to "${sanitizedPath}"`);
      }
      
      if (sanitizedPath === '') {
        console.log(`[ScoroMD Debug] Empty path after sanitization, skipping folder creation`);
        return;
      }
      
      const folderExists = await this.app.vault.adapter.exists(sanitizedPath);
      if (this.developerMode) {
        console.log(`[ScoroMD Debug] Folder exists check for "${sanitizedPath}": ${folderExists}`);
      }
      
      if (!folderExists) {
        // Create folders recursively by splitting the path
        const segments = sanitizedPath.split('/');
        if (this.developerMode) {
          console.log(`[ScoroMD Debug] Creating folder segments: ${segments.join(', ')}`);
        }
        
        let currentPath = '';
        
        for (const segment of segments) {
          if (segment === '') continue;
          
          currentPath += (currentPath ? '/' : '') + segment;
          if (this.developerMode) {
            console.log(`[ScoroMD Debug] Checking segment path: ${currentPath}`);
          }
          
          const exists = await this.app.vault.adapter.exists(currentPath);
          if (this.developerMode) {
            console.log(`[ScoroMD Debug] Segment exists check for "${currentPath}": ${exists}`);
          }
          
          if (!exists) {
            if (this.developerMode) {
              console.log(`[ScoroMD Debug] Creating folder: ${currentPath}`);
            }
            try {
              await this.app.vault.createFolder(currentPath);
              if (this.developerMode) {
                console.log(`[ScoroMD Debug] Successfully created folder: ${currentPath}`);
              }
            } catch (folderError) {
              console.error(`[ScoroMD Debug] Error creating folder "${currentPath}":`, folderError);
              throw folderError;
            }
          }
        }
      } else {
        if (this.developerMode) {
          console.log(`[ScoroMD Debug] Folder already exists: ${sanitizedPath}`);
        }
      }
    } catch (error) {
      console.error(`[ScoroMD Debug] Exception in ensureFolder for path "${path}":`, error);
      NotificationService.showError(`Failed to ensure folder: ${path}`, error);
      throw error;
    }
  }

  async createOrUpdateNote(path: string, content: string): Promise<void> {
    try {
      // Sanitize path
      const sanitizedPath = this.sanitizePath(path, { preserveSlashes: true });
      
      if (sanitizedPath !== path) {
        console.log(`Path sanitized from "${path}" to "${sanitizedPath}"`);
      }
      
      const fileExists = await this.app.vault.adapter.exists(sanitizedPath);
      
      if (fileExists) {
        const file = this.app.vault.getAbstractFileByPath(sanitizedPath) as TFile;
        const existingContent = await this.app.vault.read(file);
        
        // Check if this is a Scoro note (should have ID in frontmatter)
        const scoroIdMatch = content.match(/^---\s*\n(?:.*\n)*?([a-z_]+_id): ([^\n]+)/m);
        
        if (scoroIdMatch) {
          const [_, idField, idValue] = scoroIdMatch;
          
          // Check if existing note is missing the Scoro ID
          const missingId = !existingContent.includes(idField) || !existingContent.match(new RegExp(`${idField}:\\s*\\S+`, 'm'));
          
          if (missingId) {
            // Extract the note title from the path
            const noteTitle = sanitizedPath.split('/').pop()?.replace('.md', '') || 'Note';
            
            // Ask user what to do
            const options = ['Replace Note', 'Update Front Matter', `Create "${noteTitle} - Scoro"`, 'Cancel'];
            const choice = await this.showUserPrompt(
              `Found existing note "${noteTitle}" missing Scoro ID (${idField}). What would you like to do?`, 
              options
            );
            
            switch (choice) {
              case 'Replace Note':
                await this.app.vault.modify(file, content);
                NotificationService.showInfo(`Replaced note: ${sanitizedPath}`);
                break;
                
              case 'Update Front Matter':
                const updatedContent = this.updateFrontMatter(existingContent, idField, idValue);
                await this.app.vault.modify(file, updatedContent);
                NotificationService.showInfo(`Updated front matter: ${sanitizedPath}`);
                break;
                
              case `Create "${noteTitle} - Scoro"`:
                const newPath = sanitizedPath.replace('.md', ' - Scoro.md');
                await this.app.vault.create(newPath, content);
                NotificationService.showInfo(`Created note: ${newPath}`);
                break;
                
              case 'Cancel':
                NotificationService.showInfo(`Sync canceled for: ${sanitizedPath}`);
                break;
            }
            
            return;
          } else {
            // This is an existing Scoro note - update only the frontmatter
            const updatedContent = this.mergeFrontMatterPreservingContent(existingContent, content);
            await this.app.vault.modify(file, updatedContent);
            NotificationService.showInfo(`Updated Scoro data in: ${sanitizedPath}`);
            return;
          }
        }
        
        // Default case: just update the existing file
        await this.app.vault.modify(file, content);
      } else {
        await this.app.vault.create(sanitizedPath, content);
      }
    } catch (error) {
      NotificationService.showError(`Failed to create/update note: ${path}`, error);
      throw error;
    }
  }

  /**
   * Merges the frontmatter from new content into existing content, preserving user content
   * @param existingContent The existing note content
   * @param newContent The new content with updated frontmatter
   * @returns The merged content with updated frontmatter and preserved body
   */
  private mergeFrontMatterPreservingContent(existingContent: string, newContent: string): string {
    // Extract frontmatter from new content
    const newFrontmatterMatch = newContent.match(/^---\s*\n((?:.*\n)*?)---\s*\n/);
    if (!newFrontmatterMatch) return existingContent; // No frontmatter in new content
    
    const newFrontmatter = newFrontmatterMatch[1];
    
    // Check if existing content has frontmatter
    const existingFrontmatterMatch = existingContent.match(/^---\s*\n((?:.*\n)*?)---\s*\n([\s\S]*)/);
    if (!existingFrontmatterMatch) {
      // No frontmatter in existing content, add it
      return `---\n${newFrontmatter}---\n\n${existingContent}`;
    }
    
    // Get the body content after the frontmatter
    const existingBody = existingFrontmatterMatch[2];
    
    // Check if this is a task note with description section to update
    let updatedBody = existingBody;
    
    // Look for the new section heading followed by blockquote format
    const newDescriptionMatch = newContent.match(/## SCORO_DESCRIPTION\s*\n>([\s\S]*?)(?=\n\n##|$)/);
    const existingDescriptionMatch = existingBody.match(/## SCORO_DESCRIPTION\s*\n>([\s\S]*?)(?=\n\n##|$)/);
    
    if (newDescriptionMatch && existingDescriptionMatch) {
      // Update the description section while preserving the rest of the content
      updatedBody = existingBody.replace(
        /## SCORO_DESCRIPTION\s*\n>([\s\S]*?)(?=\n\n##|$)/,
        newDescriptionMatch[0]
      );
    } else if (newDescriptionMatch && !existingDescriptionMatch) {
      // Add the description section at the beginning of the content if it doesn't exist
      updatedBody = newDescriptionMatch[0] + '\n\n' + existingBody;
    }
    
    // For backward compatibility, also check for the old formats
    if (!newDescriptionMatch && !existingDescriptionMatch) {
      // Check for the callout format
      const calloutNewMatch = newContent.match(/> \[!SCORO_DESCRIPTION\][\s\S]*?(?=\n\n[^>]|$)/);
      const calloutExistingMatch = existingBody.match(/> \[!SCORO_DESCRIPTION\][\s\S]*?(?=\n\n[^>]|$)/);
      
      if (calloutNewMatch && calloutExistingMatch) {
        updatedBody = existingBody.replace(
          /> \[!SCORO_DESCRIPTION\][\s\S]*?(?=\n\n[^>]|$)/,
          calloutNewMatch[0]
        );
      } else if (calloutNewMatch && !calloutExistingMatch) {
        updatedBody = calloutNewMatch[0] + '\n\n' + existingBody;
      } else {
        // Check for the HTML comment format
        const htmlNewMatch = newContent.match(/<!-- SCORO_DESCRIPTION_START -->([\s\S]*?)<!-- SCORO_DESCRIPTION_END -->/);
        const htmlExistingMatch = existingBody.match(/<!-- SCORO_DESCRIPTION_START -->([\s\S]*?)<!-- SCORO_DESCRIPTION_END -->/);
        
        if (htmlNewMatch && htmlExistingMatch) {
          updatedBody = existingBody.replace(
            /<!-- SCORO_DESCRIPTION_START -->([\s\S]*?)<!-- SCORO_DESCRIPTION_END -->/,
            htmlNewMatch[0]
          );
        } else if (htmlNewMatch && !htmlExistingMatch) {
          updatedBody = htmlNewMatch[0] + '\n\n' + existingBody;
        }
      }
    }
    
    // Replace the frontmatter in the existing content
    return `---\n${newFrontmatter}---\n\n${updatedBody}`;
  }

  private async showUserPrompt(message: string, options: string[]): Promise<string> {
    return new Promise((resolve) => {
      const modal = new SimpleChoiceModal(this.app, message, options, (choice) => {
        resolve(choice);
      });
      modal.open();
    });
  }

  private updateFrontMatter(content: string, idField: string, idValue: string): string {
    // Check if the content already has front matter
    if (content.startsWith('---')) {
      // Add the ID field to the existing front matter
      return content.replace(/^---\s*\n/, `---\n${idField}: ${idValue}\n`);
    } else {
      // Create new front matter with the ID field
      return `---\n${idField}: ${idValue}\n---\n\n${content}`;
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      const sanitizedPath = this.sanitizePath(path, { preserveSlashes: true });
      
      const file = this.app.vault.getAbstractFileByPath(sanitizedPath) as TFile;
      if (!file) {
        throw new Error(`File not found: ${sanitizedPath}`);
      }
      return await this.app.vault.read(file);
    } catch (error) {
      NotificationService.showError(`Failed to read file: ${path}`, error);
      throw error;
    }
  }

  async appendToDailyNote(path: string, content: string): Promise<void> {
    try {
      // Sanitize path
      const sanitizedPath = this.sanitizePath(path);
      
      // Ensure the daily note folder structure exists
      const folderPath = sanitizedPath.substring(0, sanitizedPath.lastIndexOf('/'));
      await this.ensureFolder(folderPath);

      // Read existing content or create new file
      let existingContent = '';
      const fileExists = await this.app.vault.adapter.exists(sanitizedPath);
      
      if (fileExists) {
        const file = this.app.vault.getAbstractFileByPath(sanitizedPath) as TFile;
        existingContent = await this.app.vault.read(file);
        
        // Check if this is a time entry with task ID and time entry ID
        const taskIdMatch = content.match(/#task-([a-zA-Z0-9]+)/);
        const timeIdMatch = content.match(/#time-([a-zA-Z0-9]+)/);
        
        if (taskIdMatch && timeIdMatch) {
          const taskId = taskIdMatch[1];
          const timeEntryId = timeIdMatch[1];
          const taskNameMatch = content.match(/- \[[ x]\] (.*?) ⏱️/);
          
          if (taskNameMatch) {
            const taskName = taskNameMatch[1];
            
            // Check if there's an entry with the same task name but missing IDs
            const lines = existingContent.split('\n');
            const similarLineIndex = lines.findIndex(line => 
              line.includes(`- [ ] ${taskName} ⏱️`) && 
              (!line.includes(`#task-${taskId}`) || !line.includes(`#time-${timeEntryId}`))
            );
            
            if (similarLineIndex !== -1) {
              const similarLine = lines[similarLineIndex];
              
              // Extract the note title from the path
              const noteTitle = sanitizedPath.split('/').pop()?.replace('.md', '') || 'Daily Note';
              
              // Ask user what to do
              const options = ['Replace Entry', 'Add New Entry', 'Skip Entry', 'Cancel'];
              const choice = await this.showUserPrompt(
                `Found a similar time entry "${taskName}" in note "${noteTitle}" that may be missing Scoro IDs. What would you like to do?`, 
                options
              );
              
              switch (choice) {
                case 'Replace Entry':
                  lines[similarLineIndex] = content;
                  await this.createOrUpdateNote(sanitizedPath, lines.join('\n'));
                  NotificationService.showInfo(`Replaced time entry in: ${sanitizedPath}`);
                  return;
                  
                case 'Add New Entry':
                  // Continue with adding a new entry
                  break;
                  
                case 'Skip Entry':
                  NotificationService.showInfo(`Skipped adding time entry: ${taskName}`);
                  return;
                  
                case 'Cancel':
                  NotificationService.showInfo(`Canceled sync for time entry: ${taskName}`);
                  return;
              }
            }
          }
        }
        
        existingContent = existingContent.trim() + '\n\n';
      }

      // Append new content
      await this.createOrUpdateNote(sanitizedPath, existingContent + content);
    } catch (error) {
      NotificationService.showError(`Failed to append to daily note: ${path}`, error);
      throw error;
    }
  }

  async parseTimeEntriesFromDailyNotes(startDate: Date, endDate: Date): Promise<DailyNoteTimeEntry[]> {
    const entries: DailyNoteTimeEntry[] = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const path = this.getDailyNotePath(currentDate);
      try {
        const fileExists = await this.app.vault.adapter.exists(path);
        if (fileExists) {
          const content = await this.readFile(path);
          const dailyEntries = this.parseTimeEntriesFromContent(content, path);
          entries.push(...dailyEntries);
        } else {
          // Try to find the note in alternative locations
          const alternativePath = await this.findExistingDailyNote(currentDate);
          if (alternativePath) {
            const content = await this.readFile(alternativePath);
            const dailyEntries = this.parseTimeEntriesFromContent(content, alternativePath);
            entries.push(...dailyEntries);
          }
        }
      } catch (error) {
        NotificationService.showError(`Failed to parse time entries from: ${path}`, error);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return entries;
  }

  private parseTimeEntriesFromContent(content: string, filePath: string): DailyNoteTimeEntry[] {
    const entries: DailyNoteTimeEntry[] = [];
    const lines = content.split('\n');
    const timeEntryRegex = /- \[[ x]\] (.*?) ⏱️ (\d{2}:\d{2}) - (\d{2}:\d{2}).*?(?: - (.*?))?(?:#task-(\w+))?(?:#time-(\w+))?$/;

    for (const line of lines) {
      const match = line.match(timeEntryRegex);
      if (match) {
        const [, taskName, startTime, endTime, description, taskId, timeEntryId] = match;
        const date = this.getDateFromFilePath(filePath);
        
        if (!date) {
          NotificationService.showWarning(`Could not parse date from file path: ${filePath}`);
          continue;
        }

        const entry: DailyNoteTimeEntry = {
          task_name: taskName,
          datetime_start: this.combineDateAndTime(date, startTime),
          datetime_end: this.combineDateAndTime(date, endTime),
          description: description,
          task_id: taskId,
          time_entry_id: timeEntryId,
          file_path: this.sanitizeFolderPath(filePath)
        };

        entries.push(entry);
      }
    }

    return entries;
  }

  private getDateFromFilePath(filePath: string): Date | null {
    // First try to extract date from the filename itself
    const fileName = this.sanitizeFolderPath(filePath).split('/').pop()?.replace('.md', '') || '';
    
    // Try various date formats in the filename
    const datePatterns = [
      // YYYY-MM-DD
      /(\d{4})-(\d{2})-(\d{2})/,
      // MM-DD-YYYY
      /(\d{2})-(\d{2})-(\d{4})/,
      // Any other formats as needed
    ];
    
    for (const pattern of datePatterns) {
      const match = fileName.match(pattern);
      if (match) {
        if (match[0].startsWith(match[1]) && match[1].length === 4) {
          // YYYY-MM-DD format
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        } else {
          // MM-DD-YYYY format
          return new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
        }
      }
    }
    
    // If no match in filename, try to extract from folder structure (for nested daily notes)
    const pathSegments = this.sanitizeFolderPath(filePath).split('/');
    if (pathSegments.length >= 4) {
      // Try to extract from nested folder structure (yyyy/mm/dd.md)
      const fileName = pathSegments[pathSegments.length - 1];
      const yearStr = pathSegments[pathSegments.length - 3];
      const monthStr = pathSegments[pathSegments.length - 2];
      const dayStr = fileName.split('.')[0];
      
      if (/^\d{4}$/.test(yearStr) && /^\d{2}$/.test(monthStr) && /^\d{2}$/.test(dayStr)) {
        return new Date(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr));
      }
    }
    
    return null;
  }

  private combineDateAndTime(date: Date, time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined.toISOString();
  }

  async createTimeEntry(data: {
    startTime: string;
    endTime: string;
    client: string;
    project: string;
    task: string;
    people: string[];
  }): Promise<void> {
    try {
      // Get today's daily note path
      const today = new Date();
      
      // Try to find an existing daily note first
      const existingNotePath = await this.findExistingDailyNote(today);
      const path = existingNotePath || this.getDailyNotePath(today);
      
      // Ensure the daily note folder structure exists if we need to create a new note
      if (!existingNotePath) {
        const folderPath = path.substring(0, path.lastIndexOf('/'));
        await this.ensureFolder(folderPath);
      }
      
      // Sanitize data from Scoro
      const sanitizedClient = this.sanitizeScoro(data.client);
      const sanitizedProject = this.sanitizeScoro(data.project);
      const sanitizedTask = this.sanitizeScoro(data.task);
      const sanitizedPeople = data.people.map(person => this.sanitizeScoro(person));
      
      // Build the time entry content
      let content = `\n## ${data.startTime} - ${data.endTime}`;
      
      // Add project and task if available
      if (sanitizedProject) {
        content += ` | [[${sanitizedProject}]]`;
        if (sanitizedTask) {
          content += ` - [[${sanitizedTask}]]`;
        }
      } else {
        content += ' |';
      }
      
      content += ' %% fold %%';
      
      // Add client
      content += `\n- **Client**: [[${sanitizedClient}]]`;
      
      // Add people if any
      if (sanitizedPeople.length > 0) {
        content += `\n- **People**`;
        sanitizedPeople.forEach(person => {
          content += `\n\t- [[${person}]]`;
        });
      } else {
        content += `\n- **People**\n\t- `;
      }
      
      // Add details section
      content += `\n### Details\n- `;
      
      // Check if file exists, and create or append accordingly
      const fileExists = await this.app.vault.adapter.exists(path);
      
      if (fileExists) {
        const file = this.app.vault.getAbstractFileByPath(path) as TFile;
        let existingContent = await this.app.vault.read(file);
        
        // Append content
        existingContent = existingContent.trim() + '\n' + content;
        await this.app.vault.modify(file, existingContent);
      } else {
        // Create new file with YAML frontmatter
        const frontmatter = '---\n' +
                           'tags: [daily]\n' +
                           `date: ${today.toISOString().split('T')[0]}\n` +
                           '---\n\n' +
                           `# ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
        
        await this.app.vault.create(path, frontmatter + content);
      }
      
      NotificationService.showSuccess(`Added time entry to daily note: ${path}`);
    } catch (error) {
      NotificationService.showError(`Failed to create time entry in daily note`, error);
      throw error;
    }
  }

  // Getter methods for folder paths
  getClientsFolder(): string {
    return this.sanitizePath(this.clientsFolder, { preserveSlashes: true });
  }
  
  getProjectsFolderName(): string {
    return this.sanitizePath(this.projectsFolderName);
  }
  
  getTasksFolderName(): string {
    return this.sanitizePath(this.tasksFolderName);
  }

  getDailyNotesFolder(): string {
    return this.sanitizePath(this.dailyNotesFolder, { preserveSlashes: true });
  }
  
  getClientFolderPath(clientName: string): string {
    const sanitizedBase = this.getClientsFolder();
    const sanitizedClient = this.sanitizeScoro(clientName);
    return `${sanitizedBase}/${sanitizedClient}`;
  }
  
  getProjectFolderPath(clientName: string, projectName: string): string {
    const clientPath = this.getClientFolderPath(clientName);
    const projectsFolder = this.getProjectsFolderName();
    const sanitizedProject = this.sanitizeScoro(projectName);
    return `${clientPath}/${projectsFolder}/${sanitizedProject}`;
  }
  
  getTasksFolderPath(clientName: string, projectName: string): string {
    const projectPath = this.getProjectFolderPath(clientName, projectName);
    const tasksFolder = this.getTasksFolderName();
    return `${projectPath}/${tasksFolder}`;
  }
  
  getTaskPath(clientName: string, projectName: string, taskName: string): string {
    const tasksPath = this.getTasksFolderPath(clientName, projectName);
    // Replace slashes with spaces in task name before sanitizing
    const taskNameWithoutSlashes = taskName.replace(/\//g, ' ');
    const sanitizedTask = this.sanitizeScoro(taskNameWithoutSlashes);
    return `${tasksPath}/${sanitizedTask}.md`;
  }

  getUnassignedTasksFolder(): string {
    return this.sanitizePath(this.unassignedTasksFolder, { preserveSlashes: true });
  }

  getUnassignedTaskPath(taskName: string): string {
    const unassignedPath = this.getUnassignedTasksFolder();
    // Replace slashes with spaces in task name before sanitizing
    const taskNameWithoutSlashes = taskName.replace(/\//g, ' ');
    // First sanitize the task name without preserving slashes to convert them to dashes
    const sanitizedTask = this.sanitizePath(taskNameWithoutSlashes, { preserveSlashes: false });
    // Then construct and sanitize the full path with preserveSlashes
    return this.sanitizePath(`${unassignedPath}/${sanitizedTask}.md`, { preserveSlashes: true });
  }

  /**
   * Logs debug information if developerMode is enabled in settings
   * @param message Debug message
   * @param data Optional data to log
   */
  logDebug(message: string, data?: any) {
    if (this.developerMode) {
      console.log(`[ScoroMD Vault] ${message}`, data || '');
    }
  }
  
  /**
   * Returns the current plugin settings
   * @returns The plugin settings object or null if not available
   */
  getPluginSettings(): any {
    return this.settings || {};
  }

  /**
   * Check if a folder exists at the specified path
   * @param path The path to check
   * @returns True if the folder exists
   */
  async folderExists(path: string): Promise<boolean> {
    try {
      const normalizedPath = this.sanitizeFolderPath(path);
      return await this.app.vault.adapter.exists(normalizedPath);
    } catch (error) {
      console.error(`Error checking if folder exists: ${path}`, error);
      return false;
    }
  }

  /**
   * Find all project notes in the vault
   * Returns an array of project note paths
   */
  async findProjectNotes(clientsFolder: string): Promise<string[]> {
    const projectNotes: string[] = [];
    
    // Recursively search through clients folder for project notes
    const searchFolder = async (folderPath: string) => {
      const files = await this.app.vault.adapter.list(folderPath);
      
      for (const file of files.files) {
        // Only look at markdown files
        if (!file.endsWith('.md')) continue;
        
        const content = await this.readFile(file);
        // Check if this is a project note by looking for project_id in frontmatter
        if (content.includes('project_id:')) {
          projectNotes.push(file);
        }
      }
      
      // Recursively search subfolders
      for (const folder of files.folders) {
        await searchFolder(folder);
      }
    };
    
    await searchFolder(clientsFolder);
    return projectNotes;
  }

  /**
   * Find notes by their frontmatter properties
   * @param properties Object containing key-value pairs to match in frontmatter
   * @returns Array of file paths that match the criteria
   */
  async findNotesByFrontmatter(properties: Record<string, any>): Promise<string[]> {
    const matchingNotes: string[] = [];
    
    // Get all markdown files in the vault
    const files = this.app.vault.getMarkdownFiles();
    
    for (const file of files) {
      // Get the file's frontmatter from the metadata cache
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      
      // Check if all properties match
      const matches = Object.entries(properties).every(([key, value]) => 
        frontmatter[key] === value
      );
      
      if (matches) {
        matchingNotes.push(file.path);
      }
    }
    
    return matchingNotes;
  }
} 