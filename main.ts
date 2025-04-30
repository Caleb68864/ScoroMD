/**
 * ScoroMD - An Obsidian plugin for syncing with Scoro
 * 
 * This plugin enables synchronization between Obsidian and Scoro, allowing users to:
 * - View and manage clients, projects, and tasks in Obsidian
 * - Track time entries in daily notes
 * - Automatically sync changes between the two platforms
 */

import { App, Plugin, PluginSettingTab, Setting, TFolder, FuzzySuggestModal } from 'obsidian';
import { getAPI } from 'obsidian-dataview';
import { ScoroApiService } from './src/services/scoro-api';
import { VaultService } from './src/services/vault-service';
import { SyncService } from './src/services/sync-service';
import { NotificationService } from './src/utils/notifications';
import { TimeEntryModal } from './src/utils/time-entry-modal';

/**
 * Interface defining the plugin's settings structure
 */
interface ScoroSettings {
  apiBase: string;     // The base URL for the Scoro API
  apiKey: string;      // The API key for authenticating with Scoro
  companyId: string;   // The company account ID in Scoro
  userId: string;      // The user ID for time entries
  syncIntervalHours: number; // How often to sync (in hours, 0 for manual only)
  dailyNotesFolder: string; // Folder path for daily notes (default: Daily)
  clientsFolder: string; // Folder path for clients (default: Clients)
  projectsFolderName: string; // Name of the projects folder within each client folder (default: Projects)
  tasksFolderName: string; // Name of the tasks folder within each project folder (default: Tasks)
}

/**
 * Default settings used when the plugin is first installed
 */
const DEFAULT_SETTINGS: ScoroSettings = {
  apiBase: '',
  apiKey: '',
  companyId: '',
  userId: '',
  syncIntervalHours: 24,
  dailyNotesFolder: 'Daily',
  clientsFolder: 'Clients',
  projectsFolderName: 'Projects',
  tasksFolderName: 'Tasks'
};

/**
 * Main plugin class that handles initialization, settings, and core functionality
 */
export default class ScoroSyncPlugin extends Plugin {
  settings: ScoroSettings;
  syncInterval: number;
  dataviewAPI: any;
  private syncService: SyncService;
  private vaultService: VaultService;

  /**
   * Called when the plugin is loaded
   * Initializes settings, services, commands, and UI elements
   */
  async onload() {
    await this.loadSettings();
    this.dataviewAPI = getAPI();

    // Validate required settings and show warning if any are missing
    const missingSettings = this.validateRequiredSettings();
    if (missingSettings.length > 0) {
      const missingList = missingSettings.join(', ');
      NotificationService.showWarning(`Required settings missing: ${missingList}`);
    }

    // Initialize services for API communication and vault operations
    const apiService = new ScoroApiService({
      apiBase: this.settings.apiBase,
      apiKey: this.settings.apiKey,
      companyId: this.settings.companyId,
      userId: this.settings.userId
    });
    this.vaultService = new VaultService(this.app);
    this.syncService = new SyncService(apiService, this.vaultService);

    // Add ribbon icon for manual sync
    this.addRibbonIcon('refresh-cw', 'Sync All Scoro Data', async () => {
      try {
        // Check if required settings are missing
        const missingSettings = this.validateRequiredSettings();
        if (missingSettings.length > 0) {
          const missingList = missingSettings.join(', ');
          NotificationService.showError(`Cannot sync: Required settings missing: ${missingList}`);
          return;
        }
        
        await this.syncService.syncAll();
      } catch (error) {
        NotificationService.showError('Sync failed', error);
      }
    });
    
    // Add ribbon icon for adding time entries
    this.addRibbonIcon('clock', 'Add Time Entry', () => {
      this.openTimeEntryModal();
    });

    // Add settings tab to the Obsidian settings panel
    this.addSettingTab(new ScoroSettingTab(this.app, this));

    // Register command for syncing all data
    this.addCommand({
      id: 'scoro-sync-all',
      name: 'Sync All Scoro Data',
      callback: async () => {
        try {
          // Check if required settings are missing
          const missingSettings = this.validateRequiredSettings();
          if (missingSettings.length > 0) {
            const missingList = missingSettings.join(', ');
            NotificationService.showError(`Cannot sync: Required settings missing: ${missingList}`);
            return;
          }
          
          await this.syncService.syncAll();
        } catch (error) {
          NotificationService.showError('Sync failed', error);
        }
      }
    });
    
    // Register command for adding time entries
    this.addCommand({
      id: 'scoro-add-time-entry',
      name: 'Add Time Entry',
      callback: () => {
        this.openTimeEntryModal();
      }
    });

    // Start automatic sync interval if configured
    if (this.settings.syncIntervalHours > 0) {
      // Check if required settings are missing before starting sync interval
      const missingSettings = this.validateRequiredSettings();
      if (missingSettings.length === 0) {
        this.startSyncInterval();
      } else {
        const missingList = missingSettings.join(', ');
        NotificationService.showWarning(`Scheduled sync disabled: Required settings missing: ${missingList}`);
      }
    }
  }
  
  /**
   * Opens the time entry modal dialog
   * This allows users to add time entries through a form interface
   */
  private openTimeEntryModal(): void {
    const modal = new TimeEntryModal(
      this.app, 
      this.vaultService,
      (data) => {
        this.vaultService.createTimeEntry(data)
          .catch(error => {
            NotificationService.showError('Failed to create time entry', error);
          });
      }
    );
    
    modal.open();
  }

  /**
   * Called when the plugin is disabled or Obsidian is closed
   * Cleans up resources and stops any ongoing processes
   */
  onunload() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
    }
  }

  /**
   * Loads saved settings from Obsidian's data store
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Saves current settings to Obsidian's data store
   */
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Starts the automatic sync interval based on user settings
   * This will periodically sync data from Scoro at the specified interval
   */
  startSyncInterval() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
    }
    this.syncInterval = window.setInterval(
      async () => {
        try {
          await this.syncService.syncAll();
        } catch (error) {
          NotificationService.showError('Scheduled sync failed', error);
        }
      },
      this.settings.syncIntervalHours * 60 * 60 * 1000
    );
  }

  /**
   * Validates that all required settings are present
   * @returns Array of missing setting names
   */
  private validateRequiredSettings(): string[] {
    const { apiBase, apiKey, companyId, userId } = this.settings;
    
    const missingSettings: string[] = [];
    
    if (!apiBase) missingSettings.push('API Base URL');
    if (!apiKey) missingSettings.push('API Key');
    if (!companyId) missingSettings.push('Company Account ID');
    if (!userId) missingSettings.push('User ID');
    
    return missingSettings;
  }
}

/**
 * Settings tab implementation for the plugin
 * This provides the UI for configuring the plugin within Obsidian's settings
 */
class ScoroSettingTab extends PluginSettingTab {
  plugin: ScoroSyncPlugin;

  constructor(app: App, plugin: ScoroSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Creates the settings interface
   * Called each time the settings tab is opened
   */
  display(): void {
    const {containerEl} = this;
    containerEl.empty();

    containerEl.createEl('h2', {text: 'ScoroMD Settings'});

    // API Base URL setting
    new Setting(containerEl)
      .setName('API Base URL')
      .setDesc('Your Scoro API base URL (e.g., https://companyname.scoro.com)')
      .addText(text => text
        .setPlaceholder('Enter your API base URL')
        .setValue(this.plugin.settings.apiBase)
        .onChange(async (value) => {
          this.plugin.settings.apiBase = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

    // Company Account ID setting
    new Setting(containerEl)
      .setName('Company Account ID')
      .setDesc('Your Scoro company account ID')
      .addText(text => text
        .setPlaceholder('Enter your company ID')
        .setValue(this.plugin.settings.companyId)
        .onChange(async (value) => {
          this.plugin.settings.companyId = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

    // API Key setting
    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Scoro API key')
      .addText(text => text
        .setPlaceholder('Enter your API key')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));
    
    // User ID setting
    new Setting(containerEl)
      .setName('User ID')
      .setDesc('Your Scoro user ID for time entries')
      .addText(text => text
        .setPlaceholder('Enter your user ID')
        .setValue(this.plugin.settings.userId)
        .onChange(async (value) => {
          this.plugin.settings.userId = value;
          await this.plugin.saveSettings();
          this.validateRequiredSettings();
        }));

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
    
    // Projects Folder Name setting
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
    
    // Tasks Folder Name setting
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

    // Sync Interval setting
    new Setting(containerEl)
      .setName('Sync Interval (hours)')
      .setDesc('How often to sync with Scoro (0 for manual only)')
      .addText(text => text
        .setPlaceholder('24')
        .setValue(String(this.plugin.settings.syncIntervalHours))
        .onChange(async (value) => {
          const hours = parseInt(value) || 0;
          this.plugin.settings.syncIntervalHours = hours;
          await this.plugin.saveSettings();
          
          if (hours > 0) {
            this.plugin.startSyncInterval();
          } else if (this.plugin.syncInterval) {
            window.clearInterval(this.plugin.syncInterval);
          }
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