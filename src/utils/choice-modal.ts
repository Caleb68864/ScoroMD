import { App, Modal, Setting } from 'obsidian';

export class ChoiceModal extends Modal {
  private choice: string | null = null;
  private onChoiceCallback: (choice: string) => void;

  constructor(
    app: App, 
    private message: string, 
    private options: string[],
    onChoice: (choice: string) => void
  ) {
    super(app);
    this.onChoiceCallback = onChoice;
  }

  onOpen() {
    const { contentEl } = this;
    
    contentEl.addClass('scoro-choice-modal');
    
    contentEl.createEl('h3', { text: 'Scoro Sync Decision' });
    contentEl.createEl('p', { text: this.message, cls: 'scoro-modal-message' });
    
    const buttonContainer = contentEl.createDiv({ cls: 'scoro-modal-button-container' });
    
    // Apply CSS styling
    contentEl.createEl('style', {
      text: `
        .scoro-choice-modal {
          padding: 20px;
        }
        .scoro-modal-message {
          margin-bottom: 20px;
          line-height: 1.5;
        }
        .scoro-modal-button-container .setting-item {
          border: none;
          padding: 0;
          margin-bottom: 8px;
        }
        .scoro-modal-button-container .setting-item-control {
          justify-content: center;
          width: 100%;
        }
        .scoro-modal-button-container button {
          width: 100%;
          margin: 5px 0;
          padding: 10px;
          font-size: 14px;
        }
      `
    });
    
    this.options.forEach(option => {
      const buttonSetting = new Setting(buttonContainer);
      
      // Add different classes based on button type
      let btnClass = '';
      if (option === 'Replace Note') {
        btnClass = 'mod-warning';
      } else if (option === 'Update Front Matter') {
        btnClass = 'mod-cta';
      } else if (option === 'Cancel') {
        btnClass = 'mod-muted';
      }
      
      buttonSetting.addButton(btn => 
        btn
          .setButtonText(option)
          .setCta(option === 'Update Front Matter')
          .setClass(btnClass)
          .onClick(() => {
            this.choice = option;
            this.close();
            this.onChoiceCallback(option);
          })
      );
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    
    // If no choice was made, execute callback with the 'Cancel' option
    if (!this.choice && this.options.includes('Cancel')) {
      this.onChoiceCallback('Cancel');
    } else if (!this.choice) {
      this.onChoiceCallback(this.options[this.options.length - 1]);
    }
  }
} 