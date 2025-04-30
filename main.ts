/**
 * ScoroMD - An Obsidian plugin for syncing with Scoro
 * 
 * This plugin enables synchronization between Obsidian and Scoro, allowing users to:
 * - View and manage clients, projects, and tasks in Obsidian
 * - Track time entries in daily notes
 * - Automatically sync changes between the two platforms
 */

import { App, Plugin } from 'obsidian';
import { getAPI } from 'obsidian-dataview';
import { ScoroApiService } from './src/services/scoro-api';
import { VaultService } from './src/services/vault-service';
import { SyncService } from './src/services/sync-service';
import { NotificationService } from './src/utils/notifications';
import { TimeEntryModal } from './src/utils/time-entry-modal';
import { ScoroMDSettingTab } from './src/settings';

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
  developerMode: boolean; // Enable detailed logging for debugging
  // Sync options
  syncClients: boolean; // Sync clients from Scoro
  syncProjects: boolean; // Sync projects from Scoro
  syncTasks: boolean; // Sync tasks from Scoro
  syncTimeEntries: boolean; // Sync time entries from Scoro
  includePersonContacts: boolean; // Include person contacts in client sync (default: false)
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
  tasksFolderName: 'Tasks',
  developerMode: false,
  // Sync options - all enabled by default
  syncClients: true,
  syncProjects: true,
  syncTasks: true,
  syncTimeEntries: true,
  includePersonContacts: false
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
      userId: this.settings.userId,
      mode: 'obsidian', // Use obsidian mode to avoid CORS issues
      developerMode: this.settings.developerMode,
      includePersonContacts: this.settings.includePersonContacts
    });
    this.vaultService = new VaultService(this.app);
    this.syncService = new SyncService(
      apiService, 
      this.vaultService,
      this.settings.developerMode
    );

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
    this.addSettingTab(new ScoroMDSettingTab(this.app, this));

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

    // Register command to test API connection
    this.addCommand({
      id: 'scoro-test-connection',
      name: 'Test Scoro API Connection',
      callback: async () => {
        try {
          // Check if required settings are missing
          const missingSettings = this.validateRequiredSettings();
          if (missingSettings.length > 0) {
            const missingList = missingSettings.join(', ');
            NotificationService.showError(`Cannot connect: Required settings missing: ${missingList}`);
            return;
          }
          
          // Create a temporary API service just for testing
          const apiService = new ScoroApiService({
            apiBase: this.settings.apiBase,
            apiKey: this.settings.apiKey,
            companyId: this.settings.companyId,
            userId: this.settings.userId,
            mode: 'obsidian', // Use obsidian mode to avoid CORS issues
            includePersonContacts: this.settings.includePersonContacts
          });
          
          // Try to fetch a single client as a test
          await apiService.getClients();
          NotificationService.showSuccess('Successfully connected to Scoro API');
        } catch (error) {
          NotificationService.showError('API connection test failed', error);
        }
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

  /**
   * Reinitialize services when settings change
   * Used to apply developer mode settings changes
   */
  reinitializeServices() {
    // Initialize services for API communication and vault operations
    const apiService = new ScoroApiService({
      apiBase: this.settings.apiBase,
      apiKey: this.settings.apiKey,
      companyId: this.settings.companyId,
      userId: this.settings.userId,
      mode: 'obsidian', // Use obsidian mode to avoid CORS issues
      developerMode: this.settings.developerMode,
      includePersonContacts: this.settings.includePersonContacts
    });
    
    this.vaultService = new VaultService(this.app);
    this.syncService = new SyncService(
      apiService, 
      this.vaultService,
      this.settings.developerMode
    );
    
    console.log(`ScoroMD: Services reinitialized. Developer mode: ${this.settings.developerMode ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Restart the auto sync timer when settings change
   */
  restartAutoSync() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
    }
    
    this.startSyncInterval();
  }
} 