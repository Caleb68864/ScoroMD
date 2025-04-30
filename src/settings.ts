import { App, PluginSettingTab, Setting, TFolder, FuzzySuggestModal } from 'obsidian';
import ScoroSyncPlugin from '../main';
import { NotificationService } from './utils/notifications';
import { VaultService } from './services/vault-service';

export class ScoroMDSettingTab extends PluginSettingTab {
  plugin: ScoroSyncPlugin;

  constructor(app: App, plugin: ScoroSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('h2', { text: 'ScoroMD Settings' });

    containerEl.createEl('h3', { text: 'API Settings' });

    new Setting(containerEl)
      .setName('API Base URL')
      .setDesc('The base URL for the Scoro API (e.g., https://companyname.scoro.com)')
      .addText(text => text
        .setPlaceholder('https://companyname.scoro.com')
        .setValue(this.plugin.settings.apiBase)
        .onChange(async (value) => {
          this.plugin.settings.apiBase = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Scoro API key for authentication')
      .addText(text => text
        .setPlaceholder('Enter your API key')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

    new Setting(containerEl)
      .setName('Company Account ID')
      .setDesc('Your Scoro company account ID (usually the subdomain of your Scoro URL)')
      .addText(text => text
        .setPlaceholder('Enter your company account ID')
        .setValue(this.plugin.settings.companyId)
        .onChange(async (value) => {
          this.plugin.settings.companyId = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

    new Setting(containerEl)
      .setName('User ID')
      .setDesc('Your Scoro user ID for time entries and other operations')
      .addText(text => text
        .setPlaceholder('Enter your user ID')
        .setValue(this.plugin.settings.userId)
        .onChange(async (value) => {
          this.plugin.settings.userId = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

    containerEl.createEl('h3', { text: 'Sync Settings' });

    new Setting(containerEl)
      .setName('Sync Interval (hours)')
      .setDesc('How often to automatically sync with Scoro (0 for manual sync only)')
      .addSlider(slider => slider
        .setLimits(0, 24, 1)
        .setValue(this.plugin.settings.syncIntervalHours)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.syncIntervalHours = value;
          await this.plugin.saveSettings();
          this.plugin.restartAutoSync();
        }));
        
    containerEl.createEl('h4', { text: 'Sync Data Types' });
    containerEl.createEl('p', { 
      text: 'Choose which types of data to sync from Scoro',
      attr: { style: 'margin-top: 0;' }
    });
    
    new Setting(containerEl)
      .setName('Sync Clients')
      .setDesc('Sync client information from Scoro')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncClients)
        .onChange(async (value) => {
          this.plugin.settings.syncClients = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Sync Projects')
      .setDesc('Sync project information from Scoro')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncProjects)
        .onChange(async (value) => {
          this.plugin.settings.syncProjects = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Sync Tasks')
      .setDesc('Sync task information from Scoro')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncTasks)
        .onChange(async (value) => {
          this.plugin.settings.syncTasks = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Sync Time Entries')
      .setDesc('Sync time entries between Scoro and daily notes')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncTimeEntries)
        .onChange(async (value) => {
          this.plugin.settings.syncTimeEntries = value;
          await this.plugin.saveSettings();
        }));
        
    containerEl.createEl('h4', { text: 'Client Sync Options' });
    
    new Setting(containerEl)
      .setName('Include Person Contacts')
      .setDesc('Include contacts with type "person" in client sync (only company-type contacts are included by default)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includePersonContacts)
        .onChange(async (value) => {
          this.plugin.settings.includePersonContacts = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Folder Structure' });

    // Daily Notes Folder setting with efficient folder selection
    new Setting(containerEl)
      .setName('Daily Notes Folder')
      .setDesc('Folder path for daily notes (e.g., Daily or Journal/Daily)')
      .addText(text => {
        const textInput = text
          .setPlaceholder('Daily')
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value || 'Daily';
            await this.plugin.saveSettings();
          });
          
        // Add button to open folder selector
        textInput.inputEl.style.width = "180px"; // Make room for button
        
        const browseButton = createEl('button', {
          text: 'Browse',
          cls: 'mod-cta'
        });
        browseButton.style.marginLeft = "10px";
        
        browseButton.addEventListener('click', () => {
          // Create and open folder selector modal
          new FolderSuggestModal(this.app, (folder) => {
            textInput.setValue(folder);
            this.plugin.settings.dailyNotesFolder = folder || 'Daily';
            this.plugin.saveSettings();
          }).open();
        });
        
        // Insert button after input element
        textInput.inputEl.parentElement?.appendChild(browseButton);
        
        return textInput;
      });
      
    // Clients Folder setting with efficient folder selection
    new Setting(containerEl)
      .setName('Clients Folder')
      .setDesc('Folder path for clients data (e.g., Clients or Data/Clients)')
      .addText(text => {
        const textInput = text
          .setPlaceholder('Clients')
          .setValue(this.plugin.settings.clientsFolder)
          .onChange(async (value) => {
            this.plugin.settings.clientsFolder = value || 'Clients';
            await this.plugin.saveSettings();
            
            // Create new clients folder if it doesn't exist
            try {
              const vaultService = new VaultService(this.app);
              vaultService.ensureFolder(value || 'Clients').catch(error => {
                console.error(`Failed to create new clients folder: ${value}`, error);
                NotificationService.showWarning(`Failed to create new clients folder: ${value}`);
              });
            } catch (error) {
              console.error("Error creating clients folder:", error);
            }
          });
          
        // Add button to open folder selector
        textInput.inputEl.style.width = "180px"; // Make room for button
        
        const browseButton = createEl('button', {
          text: 'Browse',
          cls: 'mod-cta'
        });
        browseButton.style.marginLeft = "10px";
        
        browseButton.addEventListener('click', () => {
          // Create and open folder selector modal
          new FolderSuggestModal(this.app, (folder) => {
            textInput.setValue(folder);
            this.plugin.settings.clientsFolder = folder || 'Clients';
            this.plugin.saveSettings();
          }).open();
        });
        
        // Insert button after input element
        textInput.inputEl.parentElement?.appendChild(browseButton);
        
        return textInput;
      });

    new Setting(containerEl)
      .setName('Projects Folder Name')
      .setDesc('Name of the projects folder within each client folder')
      .addText(text => text
        .setPlaceholder('Projects')
        .setValue(this.plugin.settings.projectsFolderName)
        .onChange(async (value) => {
          this.plugin.settings.projectsFolderName = value || 'Projects';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Tasks Folder Name')
      .setDesc('Name of the tasks folder within each project folder')
      .addText(text => text
        .setPlaceholder('Tasks')
        .setValue(this.plugin.settings.tasksFolderName)
        .onChange(async (value) => {
          this.plugin.settings.tasksFolderName = value || 'Tasks';
          await this.plugin.saveSettings();
        }));
    
    containerEl.createEl('h3', { text: 'Advanced Settings' });
    
    new Setting(containerEl)
      .setName('Developer Mode')
      .setDesc('Enable detailed logging for debugging')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.developerMode)
        .onChange(async (value) => {
          this.plugin.settings.developerMode = value;
          await this.plugin.saveSettings();
          // Reinitialize services with new developer mode setting
          this.plugin.reinitializeServices();
        }));
        
    // Validate settings on initial load
    this.validateRequiredSettings();
  }
  
  /**
   * Validates required settings and shows a warning if any are missing
   * This is called when the settings tab is opened and when settings change
   */
  validateRequiredSettings(): void {
    const { apiBase, apiKey, companyId, userId } = this.plugin.settings;
    
    const missingSettings: string[] = [];
    
    if (!apiBase) missingSettings.push('API Base URL');
    if (!apiKey) missingSettings.push('API Key');
    if (!companyId) missingSettings.push('Company Account ID');
    if (!userId) missingSettings.push('User ID');
    
    if (missingSettings.length > 0) {
      const missingList = missingSettings.join(', ');
      NotificationService.showWarning(`Required settings missing: ${missingList}`);
    }
  }
}

/**
 * Modal for selecting a folder using Obsidian's built-in fuzzy matching
 */
class FolderSuggestModal extends FuzzySuggestModal<string> {
  private onSelect: (folder: string) => void;
  private folderPaths: string[] = [];

  constructor(app: App, onSelect: (folder: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Select folder for daily notes");
    this.collectFolders();
  }

  private collectFolders(): void {
    // Root folder
    this.folderPaths.push('/');
    
    // Get all folders in the vault
    const collectFolderPaths = (folder: TFolder, path = '') => {
      const folderPath = path ? `${path}/${folder.name}` : folder.name;
      this.folderPaths.push(folderPath);
      
      folder.children
        .filter(child => child instanceof TFolder)
        .forEach(subFolder => collectFolderPaths(subFolder as TFolder, folderPath));
    };
    
    // Get root folders
    this.app.vault.getAllLoadedFiles()
      .filter(file => file instanceof TFolder && file.parent === null)
      .forEach(rootFolder => collectFolderPaths(rootFolder as TFolder));
    
    // Sort folder paths
    this.folderPaths.sort();
  }

  getItems(): string[] {
    return this.folderPaths;
  }

  getItemText(folderPath: string): string {
    return folderPath === '/' ? 'Root' : folderPath;
  }

  onChooseItem(folderPath: string, evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(folderPath === '/' ? '' : folderPath);
  }
} 