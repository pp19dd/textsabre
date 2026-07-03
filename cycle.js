/* 

crafted by gemini after nagging it way too much (dropped editor files for inspection)

------------------------------------------------------------------------------
prompt: 
------------------------------------------------------------------------------

in this code here there is a "pixel" button. there is code throughout written to support it,
html, css, js for behavior. its nature is a toggle button with the 3 dot cycle selector. and
it's a firm prototype.

isolate it as a standalone JS library we can reuse: write a reusable web component version of
that button that matches current styles, is configurable, has click events you can tie into,
its states can be readable as simple and convenient properties. you can set states (for example
on load or on a hotkey patched from program using it). right now the code for that cycling
behavior is placed throughout the program and making additional buttons is too unwieldy.

make options for optional toggleable dot sections like it has now - that can be on either left
or right sides - and there can be multiple dot sections on either left or right sides (like
two right sides for text button where one cycles through text orientation and other through
font sizes).

make it configurable for variable number of dots. make dots same sizes regardless of how many
are requested. configure options for rows and columns (3 x 1 or 2x2). ask any clarifying
questions if need before starting. 


------------------------------------------------------------------------------
*grumble* step 2:
------------------------------------------------------------------------------

yes, managing hotkey listeners outside. but we have a few bugs and desired changes:


1) label is not displaying. buttons are blank

2) clicking on main portion of button should just trigger an event 'click' - but clicking on the
   "dot" section is what cycles it

3) button example with two dot sections: each section should be click-cycled independently,
   right now the click event is for the whole button i think

4) don't make the button seems like it's going down when clicking.

5) provide api method (javascript function) for changing the label during an event. right
   now for example when you cycle through "pixel" the color keeps creeping to imply size. 

------------------------------------------------------------------------------
* grumble step 3 *
------------------------------------------------------------------------------

this is great. do we have a way to make a single letter red, like in the main program buttons?
for example, L in line has styles for that.

second, can you make an option to change the cycle order. right now it goes left to right,
then down, but i think we'd prefer to make this configurable so it can go up, to down, then next
column

can you make the declarative options to set mouseover titles for main button, and any sections?
also make those changeable dynamically as well, so we can indicate which setting something might
be in. right now the titles are hard-coded in the button, but their purpose will be multipurpose.

lastly, how do we apply .selected to these buttons? do we stick to outside css, or do we
need a way to cycle whether the button is "selected"? is that done by api? 

------------------------------------------------------------------------------
* grumble step 4 *
------------------------------------------------------------------------------

the flow does not work, changing between column and row does nothing?

secondly, the red style doesn't exist for that hotkey letter indicator?

thirdly, font is slightly larger all of a sudden than the regular buttons. adjust please. 

------------------------------------------------------------------------------
* grumble step 5 *
------------------------------------------------------------------------------
- made manual corrections and adjustments to library, got tired talking about it
------------------------------------------------------------------------------

*/

/**
 * Advanced Multi-Cycle Web Component Button (Fixed Layout Engine)
 * Custom Element: <cycle-button>
 */
class CycleButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._sectionsMap = new Map();
  }

  static get observedAttributes() {
    return ['label', 'config', 'title'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'label') {
      const labelSpan = this.shadowRoot.querySelector('.fallback-label');
      if (labelSpan) labelSpan.textContent = newValue;
    } else if (name === 'title') {
      const mainArea = this.shadowRoot.querySelector('.main-label-area');
      if (mainArea) mainArea.setAttribute('title', newValue || '');
    } else {
      this.render();
    }
  }

  connectedCallback() {
    this.render();
  }

  setLabel(newLabel) {
    this.setAttribute('label', newLabel);
    this.innerHTML = '';
  }

  setMainTitle(newTitle) {
    this.setAttribute('title', newTitle);
  }

  setSectionTitle(sectionId, newTitle) {
    const sec = this._sectionsMap.get(sectionId);
    if (!sec) return;
    sec.title = newTitle;
    
    const container = this.shadowRoot.querySelector(`[data-id="${sectionId}"]`);
    if (container) {
      container.setAttribute('title', newTitle);
    }
  }

  get config() {
    try { return JSON.parse(this.getAttribute('config')) || []; } 
    catch (e) { return []; }
  }
  set config(val) { this.setAttribute('config', JSON.stringify(val)); }

  get label() { return this.getAttribute('label') || ''; }
  set label(val) { this.setAttribute('label', val); }

  getState(sectionId) {
    const sec = this._sectionsMap.get(sectionId);
    return sec ? sec.active : null;
  }

  setState(sectionId, index) {
    const sec = this._sectionsMap.get(sectionId);
    if (!sec) return;
    
    const nextIdx = (index % sec.count + sec.count) % sec.count;
    sec.active = nextIdx;
    
    this.updateDotVisuals(sectionId);
    this.dispatchCycleEvent(sectionId, nextIdx);
  }

  cycleSection(sectionId) {
    const sec = this._sectionsMap.get(sectionId);
    if (!sec) return;
    this.setState(sectionId, sec.active + 1);
  }

  dispatchCycleEvent(sectionId, activeIndex) {
    this.dispatchEvent(new CustomEvent('cycle', {
      detail: {
        sectionId,
        active: activeIndex,
        states: Object.fromEntries(
          Array.from(this._sectionsMap.entries()).map(([k, v]) => [k, v.active])
        )
      },
      bubbles: true,
      composed: true
    }));
  }

  updateDotVisuals(sectionId) {
    const sec = this._sectionsMap.get(sectionId);
    const container = this.shadowRoot.querySelector(`[data-id="${sectionId}"]`);
    if (!container) return;

    const dots = container.querySelectorAll('.dot');
    dots.forEach((dot) => {
      const logicalIdx = parseInt(dot.getAttribute('data-idx'), 10);
      if (logicalIdx === sec.active) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  initSectionsMap() {
    const currentConfig = this.config;
    currentConfig.forEach(sec => {
      if (!sec.id) return;
      const existing = this._sectionsMap.get(sec.id);
      this._sectionsMap.set(sec.id, {
        id: sec.id,
        side: sec.side || 'right',
        count: sec.count || 3,
        layout: sec.layout || `${sec.count}x1`,
        order: sec.order || 'row', 
        title: existing ? existing.title : (sec.title || ''),
        active: existing ? existing.active : (sec.active || 0)
      });
    });
  }

  render() {
    this.initSectionsMap();
    const sections = Array.from(this._sectionsMap.values());

    const leftSections = sections.filter(s => s.side === 'left');
    const rightSections = sections.filter(s => s.side === 'right');

    const renderDotsGroup = (sec) => {
      const [rows, cols] = sec.layout.split('x').map(Number);
      let dotsHtml = '';

      // Fix 1: Properly size and map coordinates down columns vs across rows
      const matrix = Array.from({ length: rows }, () => Array(cols).fill(null));
      let indexCounter = 0;

      if (sec.order === 'column') {
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (indexCounter < sec.count) {
              matrix[r][c] = indexCounter++;
            }
          }
        }
      } else {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (indexCounter < sec.count) {
              matrix[r][c] = indexCounter++;
            }
          }
        }
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const logicalIdx = matrix[r][c];
          if (logicalIdx !== null) {
            const isActive = logicalIdx === sec.active ? 'active' : '';
            dotsHtml += `<span class="dot ${isActive}" data-idx="${logicalIdx}"></span>`;
          } else {
            dotsHtml += `<span class="dot-spacer"></span>`;
          }
        }
      }

      const gridStyles = `
        grid-template-rows: repeat(${rows || 1}, max-content);
        grid-template-columns: repeat(${cols || 1}, max-content);
      `;

      return `
        <div class="level-dots group-${sec.side}" data-id="${sec.id}" style="${gridStyles}" title="${sec.title}">
          ${dotsHtml}
        </div>
      `;
    };

    const mainTitle = this.getAttribute('title') || '';

    // Fix 2 & 3: Inherited font sizing and global shadow DOM hotkey targeting rules applied
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          --key-bg: #2c2c2c;
          --key-border: rgba(255,255,255,0.18);
          --key-top: rgba(255,255,255,0.14);
          --key-shadow: rgba(0,0,0,0.6);
          --key-text: rgba(255,255,255,0.92);
          --button-accent: #ff4444;
          --button-accent-glow: rgba(255, 68, 68, 0.4);
        }

        .kbd-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 2.15em;
          height: 2.05em;
          border-radius: 10px;
          border: 1px solid var(--key-border);
          background: linear-gradient(180deg, var(--key-top), transparent 45%), var(--key-bg);
          box-shadow: 0 2px 0 rgba(0,0,0,0.45), 0 8px 14px -10px var(--key-shadow);
          color: var(--key-text);
          font-size: 1.0rem;
          font-weight: 600;
          letter-spacing: 0.03em;
          line-height: 1;
          user-select: none;
          box-sizing: border-box;
          padding: 0;
          overflow: hidden;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        :host(.selected) .kbd-btn {
          border-color: var(--button-accent);
          box-shadow: 0 0 8px var(--button-accent-glow), 0 2px 0 var(--button-accent);
        }

        .main-label-area {
          display: inline-flex;
          align-items: center;
          align-self: stretch;
          padding: 0 0.55em;
          cursor: pointer;
        }

        .tool-label {
          display: inline-flex;
          align-items: center;
          pointer-events: none;
        }

        /* Fix 2: Explicitly style both targeted span tags and user-passed slot nodes safely inside Shadow DOM */
        ::slotted(.hotkey), .hotkey {
          color: var(--button-accent) !important;
        }

        .level-dots {
          display: inline-grid;
          justify-content: center;
          align-content: center;
          gap: 3px;
          align-self: stretch;
          cursor: pointer;
        }

        .level-dots:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .level-dots.group-left {
          border-right: 1px solid rgba(255,255,255,0.18);
          padding: 0 7px 0 6px;
        }

        .level-dots.group-right {
          border-left: 1px solid rgba(255,255,255,0.18);
          padding: 0 6px 0 7px;
        }

        .dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.18);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16);
          display: inline-block;
          pointer-events: none;
        }

        .dot-spacer {
          width: 6px;
          height: 6px;
          display: inline-block;
        }

        .dot.active {
          background: currentColor;
          box-shadow: 0 0 5px currentColor, inset 0 0 0 1px rgba(255,255,255,0.45);
        }
      </style>

      <div class="kbd-btn">
        ${leftSections.map(renderDotsGroup).join('')}
        <div class="main-label-area" title="${mainTitle}">
          <span class="tool-label">
            <slot><span class="fallback-label">${this.label}</span></slot>
          </span>
        </div>
        ${rightSections.map(renderDotsGroup).join('')}
      </div>
    `;

    this.shadowRoot.querySelector('.main-label-area').addEventListener('click', (e) => {
      e.stopPropagation();
      this.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });

    this.shadowRoot.querySelectorAll('.level-dots').forEach(dotGroup => {
      dotGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cycleSection(dotGroup.getAttribute('data-id'));
      });
    });
  }
}

customElements.define('cycle-button', CycleButton);