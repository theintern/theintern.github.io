/**
 * Intern doc viewer
 */

import * as PromisePolyfill from 'promise-polyfill';
import * as h from 'hyperscript';

import {
	Docs,
	DocInfo,
	DocSetId,
	DocSetInfo,
	DocPage,
	DocType,
	getProjects,
	getVersions,
	getDocSet,
	getDocInfo,
	getDocBaseUrl,
	getDocVersionUrl,
	getLatestVersion,
	getNextVersion
} from './docs';
import { renderApiPages } from './render_api';
import { renderMenu, renderDocPage } from './render';
import { createHash, parseHash } from './hash';
import search from './search';

const global = <any>window;
if (!global.Promise) {
	global.Promise = <typeof Promise>(<any>PromisePolyfill);
}

let viewer: HTMLElement;
let skipPageLoad = false;
let ignoreScroll = false;
let searchPanel: HTMLElement;

const searchDelay = 300;
const menuHighlightDelay = 20;

// Super simple router. The location hash fully controls the state of the
// doc viewer. Changes to the project and version selectors will update the
// hash, which will cause new content to be rendered.
window.addEventListener('hashchange', processHash);

// If the base docs page is loaded without a hash, set a default hash to
// get a docset to load.
if (!location.hash) {
	const docset = getDocSet()!;
	setHash({
		project: docset.project,
		version: docset.version,
		page: docset.docs.pages[0]
	});
} else {
	processHash();
}

// Create a promise that resolves when the doc is ready (just for
// convenience)
const ready = new Promise(resolve => {
	window.addEventListener('load', resolve);
});

ready.then(() => {
	viewer = <HTMLElement>document.body;
	searchPanel = <HTMLElement>document.querySelector('.search-panel')!;

	// Handle updates to the project + version selects.
	document.querySelector('.docs-nav')!.addEventListener('change', event => {
		const target: Element = <Element>event.target;
		if (target.tagName !== 'SELECT') {
			return;
		}

		const select = <HTMLSelectElement>target;
		const docs = getDocInfo();

		if (target.getAttribute('data-select-property') === 'project') {
			// The project was changed
			docs.project = select.value;
			docs.version = getLatestVersion(select.value).version;
			docs.page = getDocSet(docs)!.docs.pages[0];
		} else {
			// The version was changed
			docs.version = select.value;
			docs.page = getDocSet(docs)!.docs.pages[0];
		}

		setHash({
			project: docs.project,
			version: docs.version,
			page: docs.page
		});
	});

	// Open the search dropdown if the user clicks a search button
	document.querySelector('.docs-nav')!.addEventListener('click', event => {
		let target = <HTMLElement>event.target;

		if (target.classList.contains('fa')) {
			// An icon was clicked, get its parent
			target = target.parentElement!;
		}

		if (target.classList.contains('search-button')) {
			target.classList.toggle('is-active');
			viewer.classList.toggle('is-searching');
			if (viewer.classList.contains('is-searching')) {
				searchPanel.querySelector('input')!.focus();
			}
		} else if (target.classList.contains('navbar-burger')) {
			const menuId = target.getAttribute('data-target')!;
			const menu = document.getElementById(menuId)!;
			target.classList.toggle('is-active');
			menu.classList.toggle('is-active');
		}
	});

	// Live search as the user types into the search dropdown input
	let searchTimer: number | undefined;
	searchPanel.addEventListener('input', event => {
		if (searchTimer) {
			clearTimeout(searchTimer);
		}
		searchTimer = <any>setTimeout(() => {
			const results = searchPanel.querySelector('.search-results')!;
			const docType = <DocType>viewer.getAttribute('data-doc-type')!;
			search((<HTMLInputElement>event.target).value, docType, results);
		}, searchDelay);
	});

	// Clear the search field when the user clicks the 'x' in the search box
	searchPanel.querySelector('.button')!.addEventListener('click', () => {
		const results = searchPanel.querySelector('.search-results')!;
		const docType = <DocType>viewer.getAttribute('data-doc-type')!;
		const input = <HTMLInputElement>searchPanel.querySelector('input');
		input.value = '';
		search('', docType, results);
		searchPanel.querySelector('input')!.focus();
	});

	// Update the url hash as the user scrolls
	let menuTimer: number | undefined;
	const content = <HTMLElement>document.querySelector('.docs-content')!;
	content.addEventListener('scroll', () => {
		const ignoring = ignoreScroll;
		ignoreScroll = false;
		if (ignoring) {
			return;
		}
		if (menuTimer) {
			clearTimeout(menuTimer);
		}
		menuTimer = <any>setTimeout(() => {
			menuTimer = undefined;
			updateHashFromContent();
		}, menuHighlightDelay);
	});
});

/**
 * Set the location hash, optionally telling the router to ignore the hash
 * update.
 */
function setHash(newHash: string | Partial<DocInfo>, ignoreUpdate = false) {
	let hash = typeof newHash === 'string' ? newHash : createHash(newHash);
	if (ignoreUpdate && location.hash !== hash) {
		skipPageLoad = true;
	}
	location.hash = hash;
}

/**
 * Load a docset.
 *
 * An optional page and section may be provided. When the docset is
 * finished loading, the given page, or the first page in the set, will be
 * shown.
 */
function loadDocset(setId: DocSetId) {
	const docset = getDocSet(setId)!;
	const container = document.querySelector('.docs-content')!;

	if (
		container &&
		container.getAttribute('data-doc-project') === docset.project &&
		container.getAttribute('data-doc-version') === docset.version
	) {
		// The docset is already visible, so don't do anything
		return Promise.resolve(docset);
	}

	const pageNames = docset.docs.pages;
	const docBase = getDocBaseUrl(docset);
	const hasApi = Boolean(docset.docs.api);

	let cache = docset.docs.pageCache!;
	let load: PromiseLike<any>;

	if (!cache) {
		// The docset hasn't been loaded yet
		cache = docset.docs.pageCache = <{
			[name: string]: DocPage;
		}>Object.create(null);

		const loads: PromiseLike<any>[] = [];
		const docs = docset.docs;

		if (hasApi) {
			loads.push(
				fetch(docBase + docs.api).then(response => {
					return response.json();
				})
			);
		}

		loads.push(
			...pageNames.map(name => {
				return fetch(docBase + name)
					.then(response => response.text())
					.then(text => {
						return ready.then(() => {
							const element = renderDocPage(text, docset);
							const h1 = element.querySelector('h1');
							const title =
								(h1 && h1.textContent) || docset.project;
							cache[name] = { name, element, title };
						});
					});
			})
		);

		load = Promise.all(loads).then(loadData => {
			if (hasApi) {
				const data = loadData[0];
				renderApiPages(docset, data);
			}

			// All pages need to have been loaded to create the docset menu
			docs.menu = renderMenu(docset, 'docs');

			if (hasApi) {
				docs.apiMenu = renderMenu(docset, 'api', 4);
			}
		});
	} else {
		// The docset is already loaded
		load = Promise.resolve();
	}

	// When both the docset and the page are ready, update the UI
	return Promise.all([ready, load]).then(() => {
		updateNavBarLinks();
		updateDocsetSelector();
		return docset;
	});

	//  Update the links in doc navbar
	function updateNavBarLinks() {
		const navbar = <HTMLElement>document.querySelector(
			'.docs-nav .navbar-start'
		);

		navbar.classList[docset.docs.api ? 'add' : 'remove']('has-api');
		navbar.classList[docset.docs.pages ? 'add' : 'remove']('has-docs');

		['docs', 'api'].forEach((type: DocType) => {
			const link = <HTMLLinkElement>navbar.querySelector(
				`.navbar-item[data-doc-type="${type}"]`
			)!;
			link.href = createHash({
				project: docset.project,
				version: docset.version,
				type
			});
		});
	}

	// Select the currently active project in the project selector.
	function updateDocsetSelector() {
		const docs = getDocInfo();
		const selector = document.querySelector(
			'select[data-select-property="project"]'
		)!;

		if (selector.children.length === 0) {
			getProjects().forEach(name => {
				const option = h('option', { value: name }, name);
				selector.appendChild(option);
			});
		}

		const option = <HTMLOptionElement>selector.querySelector(
			`option[value="${getDocInfo().project}"]`
		);
		if (option) {
			option.selected = true;
		}

		const versions = getVersions(docs.project);
		// If more than one version is available, show the version selector
		if (versions.length > 1) {
			viewer.classList.add('multi-version');

			const selector = document.querySelector(
				'select[data-select-property="version"]'
			)!;
			selector.innerHTML = '';
			const latestVersion = getLatestVersion(docs.project).version;
			const nextVersion = getNextVersion(docs.project).version;
			versions.forEach(version => {
				let text = `v${version}`;
				if (version === latestVersion) {
					text += ' (release)';
				} else if (version === nextVersion) {
					text += ' (dev)';
				}
				selector.appendChild(
					h(
						'option',
						{ value: version, selected: version === docs.version },
						text
					)
				);
			});
		} else {
			viewer.classList.remove('multi-version');
		}
	}
}

/**
 * Show a page in the currently loaded docset
 */
function showPage(type: DocType, name: string, section?: string) {
	const docset = getDocSet()!.docs;
	const page = getPage(docset, type, name);
	const content = <HTMLElement>document.body.querySelector('.docs-content')!;
	if (content.children.length > 0) {
		content.removeChild(content.children[0]);
	}
	content.appendChild(page.element);

	// Do highlighting before scrolling a sectoin into view. Highlighting
	// also involves scroll manipulation, and if the viewer is using a
	// mobile layout, we want the content scroll to take priority over the
	// menu scroll.
	highlightActivePage();
	highlightActiveSection();

	// Showing the page will probably scroll the content area, but we don't
	// want to invoke the normal scroll handling code in this case.
	ignoreScroll = true;

	if (section) {
		const header = <HTMLElement>document.querySelector(`#${section}`);
		if (header) {
			header.scrollIntoView();
		}
	} else {
		content.scrollTop = 0;
		content.scrollIntoView();
	}
}

/**
 * Get a page from a docset
 */
function getPage(docs: Docs, type: DocType, name?: string) {
	if (!name) {
		const pageNames = type === 'docs' ? docs.pages : docs.apiPages!;
		name = pageNames[0];
	}
	return type === 'docs' ? docs.pageCache![name] : docs.apiCache![name];
}

/**
 * Highlight the active page in the sidebar menu
 */
function highlightActivePage() {
	const menu = document.querySelector('.docs-menu .menu .menu-list')!;
	const active = menu.querySelector('.is-active-page');
	if (active) {
		active.classList.remove('is-active-page');
	}

	const docs = getDocInfo();
	const currentPage = createHash({
		project: docs.project,
		version: docs.version,
		type: docs.type,
		page: docs.page
	});

	const pageLink = menu.querySelector(`li > a[href="${currentPage}"]`)!;
	if (pageLink) {
		pageLink.parentElement!.classList.add('is-active-page');
	}
}

/**
 * Highlight the active element in the sidebar menu
 */
function highlightActiveSection() {
	const menu = document.querySelector('.docs-menu .menu-list')!;
	if (!menu) {
		return;
	}

	const active = menu.querySelector('.is-active');
	if (active) {
		active.classList.remove('is-active');
	}

	const currentSection = location.hash;
	let link = <HTMLElement>menu.querySelector(
		`li > a[href="${currentSection}"]`
	)!;
	if (!link) {
		const docs = getDocInfo();
		const currentPage = createHash({
			project: docs.project,
			version: docs.version,
			type: docs.type,
			page: docs.page
		});
		link = <HTMLElement>menu.querySelector(
			`li > a[href="${currentPage}"]`
		)!;
	}

	if (link) {
		link.classList.add('is-active');
		scrollIntoViewIfNessary(
			link,
			<HTMLElement>document.querySelector('.docs-menu')!
		);
	}
}

/**
 * Install the current docset's docs menu in the menu container
 */
function showMenu(type?: DocType) {
	type = type || 'docs';
	const docs = getDocSet()!.docs;
	const menu = document.querySelector('.docs-menu .menu')!;
	const menuList = menu.querySelector('.menu-list');
	if (menuList) {
		menu.removeChild(menuList);
	}
	const docMenu = type === 'docs' ? docs.menu! : docs.apiMenu!;
	menu.appendChild(docMenu);
}

/**
 * Process the current URL hash value.
 *
 * The has has the following format:
 *
 *     <project>/<version>/<page>/<section>
 */
function processHash() {
	const ignoring = skipPageLoad;
	skipPageLoad = false;

	// Always try to update the menu highlight, even if we're skipping the
	// rest of the page load
	highlightActiveSection();

	if (ignoring) {
		return;
	}

	const hash = parseHash();
	const docset = getDocSet(hash)!;

	// The hash encodes our state -- ensure it points to a valid docset
	if (!hash.version) {
		const parts: Partial<DocInfo> = {
			project: docset.project,
			version: docset.version,
			type: hash.type
		};
		if (hash.page) {
			parts.page = hash.page;
		}
		if (hash.section) {
			parts.section = hash.section;
		}
		setHash(parts);
	} else {
		loadDocset(hash).then(() => {
			viewer.setAttribute('data-doc-type', hash.type);

			const container = document.querySelector('.docs-content')!;
			container.setAttribute('data-doc-project', docset.project);
			container.setAttribute('data-doc-version', docset.version);

			showMenu(hash.type);
			showPage(hash.type, hash.page, hash.section);
			updateGitHubButtons(docset);
		});
	}
}

/**
 * Update the hrefs for the navbar GitHub buttons
 */
function updateGitHubButtons(docs: DocSetInfo) {
	const links = <NodeListOf<HTMLAnchorElement>>document.querySelectorAll(
		'.github-button'
	);
	const url = getDocVersionUrl(docs);
	for (let i = 0; i < links.length; i++) {
		links[i].href = url;
	}
}

/**
 * Scroll an element into view if it's not currently visible within its
 * container.
 */
function scrollIntoViewIfNessary(element: HTMLElement, container: HTMLElement) {
	const viewportTop = container.offsetTop + container.scrollTop;
	const viewportBottom = viewportTop + container.clientHeight;
	const elementTop = element.offsetTop;
	const elementBottom = elementTop + element.offsetHeight;
	if (elementTop < viewportTop) {
		element.scrollIntoView(true);
	} else if (elementBottom > viewportBottom) {
		element.scrollIntoView(false);
	}
}

/**
 * Update the location hash based on the currently visible doc contents.
 */
function updateHashFromContent() {
	const content = <HTMLElement>document.querySelector('.docs-content')!;
	const elements = content.querySelectorAll('h1,h2,h3,h4')!;
	const viewportTop = content.offsetTop + content.scrollTop;

	let above: Element | undefined;
	let below: Element | undefined;
	for (let i = 1; i < elements.length; i++) {
		const element = <HTMLElement>elements[i];
		const elementTop = getOffsetTop(element);
		if (elementTop > viewportTop) {
			below = elements[i];
			above = elements[i - 1];
			break;
		}
	}

	if (!above) {
		above = elements[elements.length - 1];
	}

	const docs = getDocInfo();
	setHash(
		{
			project: docs.project,
			version: docs.version,
			type: <DocType>viewer.getAttribute('data-doc-type')!,
			page: docs.page,
			section: above.id
		},
		true
	);

	function getOffsetTop(element: HTMLElement) {
		let top = element.offsetTop;
		while (
			(element = <HTMLElement>element.offsetParent) &&
			element !== content
		) {
			top += element.offsetTop;
		}
		return top;
	}
}
