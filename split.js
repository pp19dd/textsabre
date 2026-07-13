/**
 * Reusable two-sided press-and-hold button.
 *
 * <split-button
 *     split="forward"
 *     left-label="A"
 *     right-label="D"
 *     left-value="left"
 *     right-value="right"
 *     label="rotate">
 * </split-button>
 *
 * Divider styles: vertical (default), forward (/), reverse (\), and none.
 * With split="none", the left-side attributes and slot define one full button.
 * Label slots: left, right, and label. CSS parts use the same names, with
 * additional button, surface, divider, left-label, and right-label parts.
 *
 * Events (bubbling and composed):
 * - split-press: pointer is held on one side
 * - split-release: that pointer hold ended
 * - split-action: pointer was pressed and released on the same side
 *
 * Keyboard and other integrations can mirror their state with
 * setPressed('left' | 'right', boolean), or by dispatching a split-state event
 * with detail: { side: 'left' | 'right', pressed: boolean }.
 */
class SplitButton extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._pressed = { left: false, right: false };
        this._pointerSides = new Map();
        this._keyboardSides = new Set();
    }

    static get observedAttributes() {
        return [
            'split', 'left-label', 'right-label', 'left-value', 'right-value',
            'left-title', 'right-title', 'label', 'disabled',
            'left-disabled', 'right-disabled'
        ];
    }

    connectedCallback() {
        this.render();
        window.addEventListener('blur', this._releaseAll);
        this.addEventListener('split-state', this._handleStateEvent);
    }

    disconnectedCallback() {
        window.removeEventListener('blur', this._releaseAll);
        this.removeEventListener('split-state', this._handleStateEvent);
        this._releasePointers(false);
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && this.isConnected) this.render();
    }

    get split() {
        const value = this.getAttribute('split');
        return ['vertical', 'forward', 'reverse', 'none'].includes(value) ? value : 'vertical';
    }

    set split(value) { this.setAttribute('split', value); }

    get label() { return this.getAttribute('label') || ''; }
    set label(value) { this.setAttribute('label', value); }

    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }

    isSideDisabled(side) {
        if (side !== 'left' && side !== 'right') return true;
        return this.disabled || this.hasAttribute(`${side}-disabled`);
    }

    setSideDisabled(side, disabled) {
        if (side !== 'left' && side !== 'right') return;
        this.toggleAttribute(`${side}-disabled`, Boolean(disabled));
    }

    setPressed(side, pressed) {
        if (side !== 'left' && side !== 'right') return;
        this._pressed[side] = Boolean(pressed);
        const sideButton = this.shadowRoot.querySelector(`.side-${side}`);
        if (sideButton) sideButton.classList.toggle('pressed', this._pressed[side]);
        this.toggleAttribute(`${side}-pressed`, this._pressed[side]);
    }

    _releaseAll = () => {
        this._releasePointers(true);
    };

    _handleStateEvent = event => {
        const detail = event.detail || {};
        if (typeof detail.disabled === 'boolean') {
            this.setSideDisabled(detail.side, detail.disabled);
        }
        if (typeof detail.pressed === 'boolean') {
            this.setPressed(detail.side, detail.pressed);
        }
    };

    _releasePointers(emit) {
        const sides = new Set(this._pointerSides.values());
        this._pointerSides.clear();
        sides.forEach(side => {
            this.setPressed(side, false);
            if (emit) this._dispatch('split-release', side, false);
        });
    }

    _detail(side, pressed) {
        const value = this.getAttribute(`${side}-value`) || side;
        return { side, value, pressed };
    }

    _dispatch(type, side, pressed) {
        this.dispatchEvent(new CustomEvent(type, {
            detail: this._detail(side, pressed),
            bubbles: true,
            composed: true
        }));
    }

    _bindSide(side) {
        const button = this.shadowRoot.querySelector(`.side-${side}`);
        if (!button) return;

        button.addEventListener('pointerdown', event => {
            if (this.isSideDisabled(side) || event.button !== 0) return;
            event.preventDefault();
            button.setPointerCapture(event.pointerId);
            this._pointerSides.set(event.pointerId, side);
            this.setPressed(side, true);
            this._dispatch('split-press', side, true);
        });

        const endPress = (event, cancelled) => {
            const pressedSide = this._pointerSides.get(event.pointerId);
            if (!pressedSide) return;
            this._pointerSides.delete(event.pointerId);
            this.setPressed(pressedSide, false);
            this._dispatch('split-release', pressedSide, false);

            const releaseTarget = this.shadowRoot.elementFromPoint(event.clientX, event.clientY);
            const releasedOnSameSide = releaseTarget === button || button.contains(releaseTarget);
            if (!cancelled && releasedOnSameSide && pressedSide === side) {
                this._dispatch('split-action', side, false);
            }
        };

        button.addEventListener('pointerup', event => endPress(event, false));
        button.addEventListener('pointercancel', event => endPress(event, true));
        button.addEventListener('lostpointercapture', event => endPress(event, true));

        button.addEventListener('keydown', event => {
            if (this.isSideDisabled(side) || event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
            event.preventDefault();
            this._keyboardSides.add(side);
            this.setPressed(side, true);
            this._dispatch('split-press', side, true);
        });

        button.addEventListener('keyup', event => {
            if ((event.key !== ' ' && event.key !== 'Enter') || !this._keyboardSides.has(side)) return;
            event.preventDefault();
            this._keyboardSides.delete(side);
            this.setPressed(side, false);
            this._dispatch('split-release', side, false);
            this._dispatch('split-action', side, false);
        });

        button.addEventListener('blur', () => {
            if (!this._keyboardSides.has(side)) return;
            this._keyboardSides.delete(side);
            this.setPressed(side, false);
            this._dispatch('split-release', side, false);
        });
    }

    render() {
        const split = this.split;
        const isSplit = split !== 'none';
        const label = this.label;
        const hasLabel = Boolean(label || this.querySelector('[slot="label"]'));
        const leftDisabled = this.isSideDisabled('left');
        const rightDisabled = this.isSideDisabled('right');
        const leftLabel = this.getAttribute('left-label') || '';
        const rightLabel = this.getAttribute('right-label') || '';
        const leftTitle = this.getAttribute('left-title') || leftLabel;
        const rightTitle = this.getAttribute('right-title') || rightLabel;

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    flex-direction: column;
                    align-items: center;
                    color: rgba(255,255,255,0.75);
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
                        "Liberation Mono", "DejaVu Sans Mono", monospace;
                    --key-bg: #2c2c2c;
                    --key-border: rgba(255,255,255,0.18);
                    --key-top: rgba(255,255,255,0.14);
                    --key-shadow: rgba(0,0,0,0.6);
                    --key-text: rgba(255,255,255,0.92);
                    --button-accent: #ff4444;
                    --button-accent-glow: rgba(255, 68, 68, 0.4);
                    --split-width: 4.3em;
                    --split-height: 2.05em;
                    --split-radius: 10px;
                    --split-line: rgba(255,255,255,0.22);
                    --split-label-gap: 0.3em;
                }

                .root {
                    display: inline-flex;
                    flex-direction: column;
                    align-items: center;
                    gap: var(--split-label-gap);
                }

                .surface {
                    position: relative;
                    width: var(--split-width);
                    height: var(--split-height);
                    overflow: hidden;
                    border: 1px solid var(--key-border);
                    border-radius: var(--split-radius);
                    background: linear-gradient(180deg, var(--key-top), transparent 45%), var(--key-bg);
                    box-shadow: 0 2px 0 rgba(0,0,0,0.45), 0 8px 14px -10px var(--key-shadow);
                    box-sizing: border-box;
                    transition: border-color 60ms ease, box-shadow 60ms ease;
                }

                .side {
                    position: absolute;
                    inset: 0;
                    appearance: none;
                    border: 0;
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    color: var(--key-text);
                    cursor: pointer;
                    font: inherit;
                    font-size: 1rem;
                    font-weight: 600;
                    letter-spacing: 0.03em;
                    line-height: 1;
                    user-select: none;
                    touch-action: none;
                }

                .side-left { clip-path: polygon(0 0, 50% 0, 50% 100%, 0 100%); }
                .side-right { clip-path: polygon(50% 0, 100% 0, 100% 100%, 50% 100%); }
                .split-none .side-left { clip-path: none; }
                .split-forward .side-left { clip-path: polygon(0 0, 65% 0, 35% 100%, 0 100%); }
                .split-forward .side-right { clip-path: polygon(65% 0, 100% 0, 100% 100%, 35% 100%); }
                .split-reverse .side-left { clip-path: polygon(0 0, 35% 0, 65% 100%, 0 100%); }
                .split-reverse .side-right { clip-path: polygon(35% 0, 100% 0, 100% 100%, 65% 100%); }

                .side:hover { background: rgba(255,255,255,0.05); }
                .side:focus-visible { outline: 1px solid var(--button-accent); outline-offset: -3px; }
                .side.pressed { background: rgba(255,255,255,0.1); color: var(--button-accent); }
                .side:disabled {
                    opacity: 0.35;
                    filter: grayscale(1);
                    cursor: default;
                }
                .side:disabled:hover { background: transparent; }
                :host([left-pressed]) .surface,
                :host([right-pressed]) .surface {
                    border-color: var(--button-accent);
                    box-shadow: 0 0 8px var(--button-accent-glow), 0 2px 0 var(--button-accent);
                }
                :host([selected]) .surface {
                    border-color: var(--button-accent);
                    box-shadow: 0 0 8px var(--button-accent-glow), 0 2px 0 var(--button-accent);
                }

                .side-label {
                    position: absolute;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                }
                .side-left .side-label { left: 25%; }
                .side-right .side-label { left: 75%; }
                .split-none .side-left .side-label { left: 50%; }
                .split-forward .side-left .side-label { left: 27%; top: 42%; }
                .split-forward .side-right .side-label { left: 73%; top: 58%; }
                .split-reverse .side-left .side-label { left: 27%; top: 58%; }
                .split-reverse .side-right .side-label { left: 73%; top: 42%; }

                .divider {
                    position: absolute;
                    z-index: 2;
                    top: 0;
                    bottom: 0;
                    left: 50%;
                    width: 1px;
                    background: var(--split-line);
                    pointer-events: none;
                    transform-origin: center;
                }
                .split-forward .divider { transform: rotate(29deg) scaleY(1.15); }
                .split-reverse .divider { transform: rotate(-29deg) scaleY(1.15); }

                .caption {
                    min-height: 1em;
                    color: inherit;
                    font-size: 1rem;
                    line-height: 1;
                    text-align: center;
                }
                .caption.empty { display: none; }

                :host([disabled]) { opacity: 0.5; }
                :host([disabled]) .side { cursor: default; }
            </style>

            <div class="root" part="button">
                <div class="surface split-${split}" part="surface">
                    <button class="side side-left" part="left" type="button"
                        title="${this._escape(leftTitle)}" aria-label="${this._escape(leftTitle)}" ${leftDisabled ? 'disabled' : ''}>
                        <span class="side-label" part="left-label"><slot name="left">${this._escape(leftLabel)}</slot></span>
                    </button>
                    ${isSplit ? `<button class="side side-right" part="right" type="button"
                        title="${this._escape(rightTitle)}" aria-label="${this._escape(rightTitle)}" ${rightDisabled ? 'disabled' : ''}>
                        <span class="side-label" part="right-label"><slot name="right">${this._escape(rightLabel)}</slot></span>
                    </button>
                    <span class="divider" part="divider"></span>` : ''}
                </div>
                <div class="caption ${hasLabel ? '' : 'empty'}" part="label"><slot name="label">${this._escape(label)}</slot></div>
            </div>
        `;

        this.setPressed('left', this._pressed.left);
        this.setPressed('right', this._pressed.right);
        this._bindSide('left');
        if (isSplit) this._bindSide('right');
    }

    _escape(value) {
        return String(value).replace(/[&<>"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
        })[character]);
    }
}

if (!customElements.get('split-button')) {
    customElements.define('split-button', SplitButton);
}
