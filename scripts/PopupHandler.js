/**
 * A class to handle the sizing of a popup box like a character sheet.
 *
 * Updated for ApplicationV2: sizes are measured from the DOM and applied
 * through `Application#setPosition` so the core window manager stays in sync.
 *
 * @class PopupHandler
 */
export default class PopupHandler {
	/**
	 * Creates an instance of PopupHandler.
	 * @param {ApplicationV2} application - A reference to an application such as a character sheet
	 * @param {string} layoutselector     - A CSS selector that selects the main container for the layout
	 * @param {number} defaultWidth       - The starting width of the popup
	 * @param {number} defaultHeight      - The maximum height of the popup
	 * @param {number} padding            - The padding around the popup content
	 * @param {number} scale              - The CSS transform scale to set on this sheet
	 * @memberof PopupHandler
	 */
	constructor(application, layoutselector, defaultWidth, defaultHeight, padding, scale) {
		this.application = application;
		this.padding = padding;
		/** @type {HTMLElement} */
		this.element = application.element;
		this._height = defaultHeight;
		this._width = defaultWidth;
		this._scale = scale || 1;

		/** @type {HTMLElement} */
		this.container = this.element.querySelector(layoutselector);
		this.layout = this.container ? Array.from(this.container.children) : [];
	}

	get computedWidth() { return parseFloat(window.getComputedStyle(this.element).width); }
	get position() { return this.application.position; }

	/**
	 * The gap between columns in pixels.
	 *
	 * @readonly
	 * @memberof PopupHandler
	 */
	get columnGap() {
		if (!this.container) return 0;
		const gap = parseFloat(window.getComputedStyle(this.container).columnGap);
		return Number.isFinite(gap) ? gap : 0;
	}

	/**
	 * Returns the largest offset from the left side of the layout
	 * that any element's right edge has (this is the maximum width of the layout).
	 *
	 * @readonly
	 * @memberof PopupHandler
	 */
	get layoutWidth() {
		const left = this.container.getBoundingClientRect().left;
		return this.layout.reduce((width, el) => {
			const right = el.getBoundingClientRect().right - left;
			return right > width ? right : width;
		}, 0);
	}

	/**
	 * Returns the greatest offset from the top of the window
	 * of any element's bottom (this is the maximum height of the layout).
	 *
	 * @readonly
	 * @memberof PopupHandler
	 */
	get layoutHeight() {
		const top = this.element.getBoundingClientRect().top;
		return this.layout.reduce((height, el) => {
			// The bottom of the bounding rectangle is the *real* lowest point of the rendered element,
			// even if the element is split between multiple columns.
			const bottom = el.getBoundingClientRect().bottom - top;
			return bottom > height ? bottom : height;
		}, 46);
	}

	getWidthCSSString(columns) {
		const gaps = columns - 1;
		const gap = gaps ? `+ var(--column-gap) * ${gaps}` : "";

		return `calc(var(--column-width) * ${columns} ${gap} + var(--window-padding) * 2)`;
	}

	fix() {
		if (!this.container) return;

		// Remove any scaling so that measurements are accurate.
		this.element.style.transform = "";

		// Start with a single column at the maximum height, so the column layout overflows to the right.
		this.element.style.width = this.getWidthCSSString(1);
		this.element.style.height = `${this._height}px`;

		const baseWidth = this.container.getBoundingClientRect().width;
		const gap = this.columnGap;
		const columns = Math.max(1, Math.round((this.layoutWidth + gap) / (baseWidth + gap)));

		// Width needs corrected first, so that the column layout will expand and balance correctly.
		this.element.style.width = this.getWidthCSSString(columns);
		const width = this.computedWidth;

		// Once the layout is balanced, we can correct the height to match it.
		const height = Math.ceil(this.layoutHeight + this.padding);
		this.element.style.height = `${height}px`;

		const position = { width, height };

		// On the first fit, keep the sheet centered on where it was opened.
		if (!this.application._monsterblockPositioned) {
			const left = this.position.left ?? 0;
			const top = this.position.top ?? 0;
			const startWidth = this.application.options.position?.width ?? width;
			const startHeight = Number(this.application.options.position?.height) || height;
			position.left = Math.max(0, left - ((width - startWidth) / 2));
			position.top = Math.max(0, top - ((height - startHeight) / 2));
			this.application._monsterblockPositioned = true;
		}

		if (this._scale != 1) position.scale = this._scale;

		this.application.setPosition(position);
	}
}
