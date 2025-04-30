/**
 * TimeEntryModal - Modal dialog for adding time entries to daily notes
 * 
 * This class provides a user-friendly form interface for adding time entries
 * to daily notes without having to manually format the entries. It shows 
 * a modal dialog with fields for start/end time, client, project, task, and people.
 */

import { App, Modal, Setting, DropdownComponent, TextComponent, Notice, TFolder, TFile } from 'obsidian';
import { VaultService } from '../services/vault-service';

/**
 * Interface defining the data structure for a time entry
 */
interface TimeEntryData {
  startTime: string;    // Start time in HH:MM format
  endTime: string;      // End time in HH:MM format
  client: string;       // Client name
  project: string;      // Project name
  task: string;         // Task name (optional)
  people: string[];     // Array of people involved
}

/**
 * Modal dialog for creating time entries with a user-friendly form
 */
export class TimeEntryModal extends Modal {
  private vault: VaultService;
  private clients: string[] = [];
  private projects: Map<string, string[]> = new Map();
  private tasks: Map<string, string[]> = new Map();
  private contacts: string[] = [];
  
  /**
   * Default data structure for a new time entry
   * The start time is initialized to the current time rounded to 15 minutes
   */
  private data: TimeEntryData = {
    startTime: this.getCurrentTime(),
    endTime: "00:00",
    client: "",
    project: "",
    task: "",
    people: []
  };
  
  // UI Components
  private clientDropdown: DropdownComponent;
  private projectDropdown: DropdownComponent;
  private taskDropdown: DropdownComponent;
  private startTimeInput: TextComponent;
  private endTimeInput: TextComponent;
  private peopleContainer: HTMLElement;
  private currentPeople: string[] = [];
  
  /**
   * Creates a new TimeEntryModal
   * 
   * @param app - The Obsidian app instance
   * @param vaultService - The vault service for accessing the vault
   * @param onSubmit - Callback function called when the form is submitted
   */
  constructor(
    app: App,
    private vaultService: VaultService,
    private onSubmit: (data: TimeEntryData) => void
  ) {
    super(app);
    this.vault = vaultService;
  }
  
  /**
   * Called when the modal is opened
   * Creates and renders the form interface
   */
  async onOpen() {
    const { contentEl } = this;
    
    contentEl.addClass('scoro-time-entry-modal');
    
    contentEl.createEl('h3', { text: 'Add Time Entry' });
    
    // Apply CSS styling
    contentEl.createEl('style', {
      text: `
        .scoro-time-entry-modal {
          padding: 20px;
          width: 500px;
        }
        .scoro-time-entry-section {
          margin-bottom: 20px;
        }
        .scoro-time-column {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 20px;
        }
        .scoro-people-container {
          margin-top: 10px;
          margin-bottom: 20px;
        }
        .scoro-people-list {
          margin-top: 10px;
          padding: 10px;
          background-color: var(--background-secondary);
          border-radius: 5px;
          max-height: 100px;
          overflow-y: auto;
        }
        .scoro-people-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px;
          margin-bottom: 5px;
          background-color: var(--background-primary);
          border-radius: 3px;
        }
        .scoro-people-item-remove {
          cursor: pointer;
          color: var(--text-error);
        }
        .scoro-time-entry-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }
      `
    });
    
    // Time section - vertical layout
    const timeSection = contentEl.createDiv({ cls: 'scoro-time-column' });
    
    // Start time
    new Setting(timeSection)
      .setName('Start Time')
      .setDesc('Time entry starts')
      .addText(text => {
        this.startTimeInput = text;
        text.setValue(this.data.startTime)
            .onChange(value => {
              this.data.startTime = value;
            });
      });
    
    // End time
    new Setting(timeSection)
      .setName('End Time')
      .setDesc('Time entry ends (leave 00:00 to fill later)')
      .addText(text => {
        this.endTimeInput = text;
        text.setValue(this.data.endTime)
            .onChange(value => {
              this.data.endTime = value;
            });
      });
    
    // Load data from the vault
    await this.loadData();
    
    // Client selection (added to UI first)
    new Setting(contentEl)
      .setName('Client')
      .setDesc('Select a client')
      .addDropdown(dropdown => {
        this.clientDropdown = dropdown;
        dropdown.addOption("", "Select a client...");
        this.clients.forEach(client => {
          dropdown.addOption(client, client);
        });
        dropdown.onChange(async (value) => {
          this.data.client = value;
          this.data.project = "";
          this.data.task = "";
          
          // Update project dropdown based on selected client
          await this.updateProjectDropdown(value);
        });
        return dropdown;
      });
    
    // Project selection
    new Setting(contentEl)
      .setName('Project')
      .setDesc('Select a project')
      .addDropdown(dropdown => {
        this.projectDropdown = dropdown;
        dropdown.addOption("", "Select a project...");
        dropdown.onChange(async (value) => {
          this.data.project = value;
          this.data.task = "";
          
          // Update task dropdown based on selected project
          await this.updateTaskDropdown(value);
        });
        return dropdown;
      });
    
    // Task selection
    new Setting(contentEl)
      .setName('Task')
      .setDesc('Select a task (optional)')
      .addDropdown(dropdown => {
        this.taskDropdown = dropdown;
        dropdown.addOption("", "Select a task (optional)...");
        dropdown.onChange(value => {
          this.data.task = value;
        });
        return dropdown;
      });
    
    // People section
    const peopleSection = contentEl.createDiv({ cls: 'scoro-time-entry-section' });
    
    new Setting(peopleSection)
      .setName('People')
      .setDesc('Add people to this time entry')
      .addDropdown(dropdown => {
        dropdown.addOption("", "Add a person...");
        this.contacts.forEach(contact => {
          dropdown.addOption(contact, contact);
        });
        dropdown.onChange(value => {
          if (value) {
            this.addPerson(value);
            dropdown.setValue("");
          }
        });
      });
    
    // People list container
    this.peopleContainer = peopleSection.createDiv({ cls: 'scoro-people-container' });
    this.updatePeopleList();
    
    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'scoro-time-entry-buttons' });
    
    const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    
    const saveButton = buttonContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });
    saveButton.addEventListener('click', () => {
      if (!this.validateForm()) {
        return;
      }
      
      this.data.people = this.currentPeople;
      this.onSubmit(this.data);
      this.close();
    });
  }
  
  /**
   * Called when the modal is closed
   * Cleans up resources
   */
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
  
  /**
   * Gets the current time rounded to the nearest 15 minutes
   * @returns Current time in HH:MM format
   * @private
   */
  private getCurrentTime(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = Math.floor(now.getMinutes() / 15) * 15;
    const minutesStr = minutes.toString().padStart(2, '0');
    return `${hours}:${minutesStr}`;
  }
  
  /**
   * Loads clients, projects, tasks, and contacts from the vault
   * This method populates the dropdown menus with available options
   * @private
   */
  private async loadData() {
    try {
      // Load clients
      const clientsFolder = this.app.vault.getAbstractFileByPath('Clients') as TFolder;
      if (clientsFolder && clientsFolder instanceof TFolder) {
        this.clients = clientsFolder.children
          .filter(folder => folder instanceof TFolder)
          .map(folder => folder.name);
      }
      
      // Add Logic as an option
      this.clients.push('Logic');
      this.clients.sort();
      
      // Load projects for each client
      for (const client of this.clients) {
        await this.loadProjectsForClient(client);
      }
      
      // Load contacts
      const allFiles = this.app.vault.getMarkdownFiles();
      this.contacts = allFiles
        .filter(file => 
          file.path.match(/Logic\/Employees\/.*\.md/) || 
          file.path.match(/Clients\/.*\/Contacts\/.*\.md/)
        )
        .map(file => file.basename);
      
      this.contacts.sort();
      
    } catch (error) {
      console.error("Error loading data for time entry modal:", error);
      new Notice("Failed to load data for time entry form");
    }
  }
  
  /**
   * Loads projects for a specific client
   * For the 'Logic' client, adds special predefined projects
   * 
   * @param client - The client name
   * @private
   */
  private async loadProjectsForClient(client: string) {
    if (client === 'Logic') {
      const logicProjects = ['Logic Operations', 'Logic Solutions'];
      this.projects.set(client, logicProjects);
      
      // Add tasks for Logic Operations
      this.tasks.set('Logic Operations', ['Resourcing', 'Invoicing', 'Level 10']);
      this.tasks.set('Logic Solutions', []);
      
      return;
    }
    
    const projectPath = `Clients/${client}/Projects`;
    const projectFolder = this.app.vault.getAbstractFileByPath(projectPath) as TFolder;
    
    if (projectFolder && projectFolder instanceof TFolder) {
      const clientProjects = projectFolder.children
        .filter(folder => folder instanceof TFolder)
        .map(folder => folder.name);
      
      this.projects.set(client, clientProjects);
      
      // Load tasks for each project
      for (const project of clientProjects) {
        await this.loadTasksForProject(client, project);
      }
    }
  }
  
  /**
   * Loads tasks for a specific project
   * 
   * @param client - The client name
   * @param project - The project name
   * @private
   */
  private async loadTasksForProject(client: string, project: string) {
    const tasksPath = `Clients/${client}/Projects/${project}/Tasks`;
    const tasksFolder = this.app.vault.getAbstractFileByPath(tasksPath) as TFolder;
    
    if (tasksFolder && tasksFolder instanceof TFolder) {
      const projectTasks = tasksFolder.children
        .filter(file => file instanceof TFile && file.extension === 'md')
        .map(file => {
          const tFile = file as TFile;
          return tFile.basename;
        });
      
      this.tasks.set(project, projectTasks);
    } else {
      this.tasks.set(project, []);
    }
  }
  
  /**
   * Updates the project dropdown based on the selected client
   * 
   * @param client - The selected client
   * @private
   */
  private async updateProjectDropdown(client: string) {
    if (!this.projectDropdown) return;
    
    const selectEl = this.projectDropdown.selectEl;
    
    // Clear existing options
    while (selectEl.options.length > 0) {
      selectEl.remove(0);
    }
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.text = "Select a project...";
    selectEl.add(defaultOption);
    
    // Reset value
    this.projectDropdown.setValue("");
    
    // Add client-specific projects
    if (client) {
      const projectsForClient = this.projects.get(client) || [];
      projectsForClient.forEach(project => {
        this.projectDropdown.addOption(project, project);
      });
    }
    
    // Also reset task dropdown since project changed
    await this.updateTaskDropdown("");
  }
  
  /**
   * Updates the task dropdown based on the selected project
   * 
   * @param project - The selected project
   * @private
   */
  private async updateTaskDropdown(project: string) {
    if (!this.taskDropdown) return;
    
    const selectEl = this.taskDropdown.selectEl;
    
    // Clear existing options
    while (selectEl.options.length > 0) {
      selectEl.remove(0);
    }
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.text = "Select a task (optional)...";
    selectEl.add(defaultOption);
    
    // Reset value
    this.taskDropdown.setValue("");
    
    // Add project-specific tasks
    if (project) {
      const tasksForProject = this.tasks.get(project) || [];
      tasksForProject.forEach(task => {
        this.taskDropdown.addOption(task, task);
      });
    }
  }
  
  /**
   * Adds a person to the current people list
   * 
   * @param person - The person to add
   * @private
   */
  private addPerson(person: string) {
    if (!this.currentPeople.includes(person)) {
      this.currentPeople.push(person);
      this.updatePeopleList();
    }
  }
  
  /**
   * Removes a person from the current people list
   * 
   * @param person - The person to remove
   * @private
   */
  private removePerson(person: string) {
    this.currentPeople = this.currentPeople.filter(p => p !== person);
    this.updatePeopleList();
  }
  
  /**
   * Updates the UI to display the current list of people
   * @private
   */
  private updatePeopleList() {
    this.peopleContainer.empty();
    
    if (this.currentPeople.length === 0) {
      this.peopleContainer.createEl('div', { 
        text: 'No people added', 
        cls: 'scoro-people-empty' 
      });
      return;
    }
    
    const list = this.peopleContainer.createDiv({ cls: 'scoro-people-list' });
    
    this.currentPeople.forEach(person => {
      const item = list.createDiv({ cls: 'scoro-people-item' });
      item.createSpan({ text: person });
      
      const removeBtn = item.createSpan({ 
        text: '✕', 
        cls: 'scoro-people-item-remove' 
      });
      
      removeBtn.addEventListener('click', () => {
        this.removePerson(person);
      });
    });
  }
  
  /**
   * Validates the form inputs before submission
   * Shows error notices if validation fails
   * 
   * @returns true if the form is valid, false otherwise
   * @private
   */
  private validateForm(): boolean {
    if (!this.data.client) {
      new Notice("Please select a client");
      return false;
    }
    
    // Validate time format (HH:MM)
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
    
    if (!timeRegex.test(this.data.startTime)) {
      new Notice("Start time must be in HH:MM format");
      return false;
    }
    
    if (this.data.endTime !== "00:00" && !timeRegex.test(this.data.endTime)) {
      new Notice("End time must be in HH:MM format");
      return false;
    }
    
    return true;
  }
} 