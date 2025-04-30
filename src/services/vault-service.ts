import { App, TFile, Vault, Modal } from 'obsidian';
import { NotificationService } from '../utils/notifications';
import { DailyNoteTimeEntry } from '../models/scoro-types';

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

  constructor(private app: App) {
    // Get the dailyNotesFolder and format setting if available
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
      }
    } catch (error) {
      console.error("Could not access plugin settings:", error);
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
   * Sanitizes a path segment (folder or file name) by removing invalid characters
   * @param pathSegment The path segment to sanitize
   * @returns Sanitized path segment
   */
  private sanitizePathSegment(pathSegment: string): string {
    // Replace characters that are not allowed in file names
    return pathSegment.replace(/[*"\\/<>:|?]/g, '_');
  }

  /**
   * Sanitizes a full path by sanitizing each path segment
   * @param path The path to sanitize
   * @returns Sanitized path
   */
  private sanitizePath(path: string): string {
    // Split the path by / and sanitize each segment
    const segments = path.split('/');
    const sanitizedSegments = segments.map(segment => {
      // Don't sanitize empty segments (e.g., between consecutive slashes)
      if (segment === '') return segment;
      return this.sanitizePathSegment(segment);
    });
    return sanitizedSegments.join('/');
  }

  /**
   * Properly handles a path that may contain spaces, avoiding issues with underscores
   * @param path Path that may contain spaces
   * @returns Path with proper folder structure
   */
  private normalizeFolderPath(path: string): string {
    // Replace any backslashes with forward slashes for consistency
    let normalizedPath = path.replace(/\\/g, '/');
    
    // Check if the path needs to be split
    // This addresses the issue where "Calendar Notes/Daily Notes" becomes "Calendar Notes_Daily Notes"
    if (normalizedPath.includes(' ') && !normalizedPath.includes('/')) {
      // Split by spaces that should be treated as folder separators
      if (normalizedPath.includes('Daily Notes')) {
        // Special case for "Calendar Notes Daily Notes" style paths
        normalizedPath = normalizedPath.replace('Daily Notes', '/Daily Notes');
      } else {
        // Generic case for other paths with spaces that should be folders
        const segments = normalizedPath.split(/\s+/);
        normalizedPath = segments.join('/');
      }
    }
    
    return normalizedPath;
  }

  getDailyNotePath(date: Date): string {
    // Normalize and sanitize the daily notes folder path
    const normalizedFolder = this.normalizeFolderPath(this.dailyNotesFolder);
    const sanitizedFolder = this.sanitizePath(normalizedFolder);
    
    // Format the date according to the format string
    const dateStr = this.formatDate(date, this.dailyNotesFormat);
    
    return `${sanitizedFolder}/${dateStr}.md`;
  }

  async ensureFolder(path: string): Promise<void> {
    try {
      // Sanitize path
      const sanitizedPath = this.sanitizePath(path);
      
      if (sanitizedPath !== path) {
        console.log(`Path sanitized from "${path}" to "${sanitizedPath}"`);
      }
      
      if (sanitizedPath === '') return;
      
      const folderExists = await this.app.vault.adapter.exists(sanitizedPath);
      if (!folderExists) {
        // Create folders recursively by splitting the path
        const segments = sanitizedPath.split('/');
        let currentPath = '';
        
        for (const segment of segments) {
          if (segment === '') continue;
          
          currentPath += (currentPath ? '/' : '') + segment;
          const exists = await this.app.vault.adapter.exists(currentPath);
          
          if (!exists) {
            await this.app.vault.createFolder(currentPath);
          }
        }
      }
    } catch (error) {
      NotificationService.showError(`Failed to ensure folder: ${path}`, error);
      throw error;
    }
  }

  async createOrUpdateNote(path: string, content: string): Promise<void> {
    try {
      // Sanitize path
      const sanitizedPath = this.sanitizePath(path);
      
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
      const sanitizedPath = this.sanitizePath(path);
      
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
          file_path: filePath
        };

        entries.push(entry);
      }
    }

    return entries;
  }

  private getDateFromFilePath(filePath: string): Date | null {
    // First try to extract date from the filename itself
    const fileName = filePath.split('/').pop()?.replace('.md', '') || '';
    
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
    const pathSegments = filePath.split('/');
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
      
      // Sanitize data before creating content
      const sanitizedClient = this.sanitizePathSegment(data.client);
      const sanitizedProject = this.sanitizePathSegment(data.project);
      const sanitizedTask = this.sanitizePathSegment(data.task);
      const sanitizedPeople = data.people.map(person => this.sanitizePathSegment(person));
      
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
} 