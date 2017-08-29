/**
 * Intern doc viewer
 */

import * as PromisePolyfill from 'promise-polyfill';
import * as h from 'hyperscript';

import {
	DocSet,
	DocSetId,
	DocPage,
	DocType,
	getProjects,
	getVersions,
	getCurrentDocSetId,
	getDefaultDocSetId,
	getDocSet,
	getCurrentPageId,
	getDefaultPageId,
	getDocBaseUrl,
	getDocVersionUrl,
	getLatestVersion,
	getNextVersion
} from './docs';
import { renderApiPages } from './render_api';
import { renderMenu, renderDocPage } from './render';
import { createHash, parseHash, updateHash, HashEvent } from './hash';
import search from './search';

const global = <any>window;
if (!global.Promise) {
	global.Promise = <typeof Promise>(<any>PromisePolyfill);
}

let viewer: HTMLElement;
let errorModal: HTMLElement;
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
	updateHash(getDefaultPageId(getDefaultDocSetId()));
	processHash();
}

// Create a promise that resolves when the doc is ready (just for
// convenience)
const ready = new Promise(resolve => {
	window.addEventListener('load', resolve);
});

ready.then(() => {
	viewer = <HTMLElement>document.body;
	errorModal = <HTMLElement>document.querySelector('.error-modal')!;
	searchPanel = <HTMLElement>document.querySelector('.search-panel')!;

	// Handle updates to the project + version selects.
	document.querySelector('.docs-nav')!.addEventListener('change', event => {
		const target: Element = <Element>event.target;
		if (target.tagName !== 'SELECT') {
			return;
		}

		const select = <HTMLSelectElement>target;
		const pageId = getCurrentPageId();

		if (target.getAttribute('data-select-property') === 'project') {
			// The project was changed
			pageId.project = select.value;
			pageId.version = getLatestVersion(select.value).version;
			pageId.page = getDocSet(pageId).pages[0];
			pageId.type = DocType.docs;
		} else {
			// The version was changed
			pageId.version = select.value;
			pageId.page = getDocSet(pageId).pages[0];
			pageId.type = DocType.docs;
		}

		updateHash(pageId);
		processHash();
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

	processHash();
});

/**
 * Load a docset.
 *
 * An optional page and section may be provided. When the docset is
 * finished loading, the given page, or the first page in the set, will be
 * shown.
 */
function loadDocSet(id: DocSetId) {
	const container = document.querySelector('.docs-content')!;

	if (
		container &&
		container.getAttribute('data-doc-project') === id.project &&
		container.getAttribute('data-doc-version') === id.version
	) {
		// The docset is already visible, so don't do anything
		return new Promise(resolve => {
			resolve(getDocSet(id));
		});
	}

	const docSet = getDocSet(id);
	const docBase = getDocBaseUrl(id);
	const pageNames = docSet.pages;
	const hasApi = Boolean(docSet.api);

	let cache = docSet.pageCache!;
	let load: PromiseLike<any>;

	if (!cache) {
		// The docset hasn't been loaded yet
		cache = docSet.pageCache = <{
			[name: string]: DocPage;
		}>Object.create(null);

		const loads: PromiseLike<any>[] = [];

		if (hasApi) {
			loads.push(
				fetch(docBase + docSet.api).then(response => {
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
							const element = renderDocPage(text, name, id);
							const h1 = element.querySelector('h1');
							const title = (h1 && h1.textContent) || id.project;
							cache[name] = { name, element, title };
						});
					});
			})
		);

		load = Promise.all(loads).then(loadData => {
			if (hasApi) {
				const data = loadData[0];
				renderApiPages(id, data);
			}

			// All pages need to have been loaded to create the docset menu
			docSet.menu = renderMenu(id, DocType.docs);

			if (hasApi) {
				docSet.apiMenu = renderMenu(id, DocType.api, 4);
			}
		});
	} else {
		// The docset is already loaded
		load = Promise.resolve();
	}

	return Promise.all([ready, load]);
}

/**
 * Update the links in doc navbar
 */
function updateNavBarLinks(id: DocSetId) {
	const docSet = getDocSet(id);
	const navbar = <HTMLElement>document.querySelector(
		'.docs-nav .navbar-start'
	);

	navbar.classList[docSet.api ? 'add' : 'remove']('has-api');
	navbar.classList[docSet.pages ? 'add' : 'remove']('has-docs');

	const docTypes = <DocType[]>Object.keys(DocType).filter(
		type => !Number(type)
	);
	for (let type of docTypes) {
		const link = <HTMLLinkElement>navbar.querySelector(
			`.navbar-item[data-doc-type="${type}"]`
		)!;
		link.href = createHash({
			project: id.project,
			version: id.version,
			type
		});
	}
}

/**
 * Select the currently active project in the project selector.
 */
function updateDocsetSelector() {
	const pageId = getCurrentPageId();
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
		`option[value="${getCurrentPageId().project}"]`
	);
	if (option) {
		option.selected = true;
	}

	const versions = getVersions(pageId.project);
	// If more than one version is available, show the version selector
	if (versions.length > 1) {
		viewer.classList.add('multi-version');

		const selector = document.querySelector(
			'select[data-select-property="version"]'
		)!;
		selector.innerHTML = '';
		const latestVersion = getLatestVersion(pageId.project).version;
		const nextVersion = getNextVersion(pageId.project).version;
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
					{ value: version, selected: version === pageId.version },
					text
				)
			);
		});
	} else {
		viewer.classList.remove('multi-version');
	}
}

/**
 * Show a page in the currently loaded docset
 */
function showPage(type: DocType, name: string, section?: string) {
	const docSet = getDocSet(getCurrentDocSetId());
	const page = getPage(docSet, type, name);
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
 * Get a rendered page from a doc set
 */
function getPage(docSet: DocSet, type: DocType, name?: string) {
	if (!name) {
		const pageNames =
			type === DocType.api ? docSet.apiPages! : docSet.pages;
		name = pageNames[0];
	}
	return type === DocType.api
		? docSet.apiCache![name]
		: docSet.pageCache![name];
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

	const pageId = getCurrentPageId(false);
	const currentPage = createHash(pageId);

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
		try {
			const docs = getCurrentPageId();
			const currentPage = createHash({
				project: docs.project,
				version: docs.version,
				type: docs.type,
				page: docs.page
			});
			link = <HTMLElement>menu.querySelector(
				`li > a[href="${currentPage}"]`
			)!;
		} catch (error) {
			// ignore
		}
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
	type = type || DocType.docs;
	const docSet = getDocSet(getCurrentDocSetId());
	const menu = document.querySelector('.docs-menu .menu')!;
	const menuList = menu.querySelector('.menu-list');
	if (menuList) {
		menu.removeChild(menuList);
	}
	const docMenu = type === DocType.api ? docSet.apiMenu! : docSet.menu!;
	menu.appendChild(docMenu);
}

/**
 * Process the current URL hash value.
 */
function processHash() {
	highlightActiveSection();

	try {
		const docSetId = getCurrentDocSetId();
		loadDocSet(docSetId).then(() => {
			try {
				const pageId = getCurrentPageId();

				hideErrorModal();
				const { project, version, type, page, section } = pageId;
				viewer.setAttribute('data-doc-type', type);

				const container = document.querySelector('.docs-content')!;
				container.setAttribute('data-doc-project', project);
				container.setAttribute('data-doc-version', version);

				showMenu(type);
				showPage(type, page, section);
				updateGitHubButtons(pageId);
				updateNavBarLinks(pageId);
				updateDocsetSelector();
			} catch (error) {
				// The current hash doesn't specify a valid page ID
				try {
					const { type } = parseHash();
					updateHash(
						createHash(
							getDefaultPageId(docSetId, type || DocType.docs)
						),
						HashEvent.rename
					);
					processHash();
				} catch (error) {
					showError(error);
				}
			}
		});
	} catch (error) {
		// The current hash doesn't identify a valid doc set
		if (!location.hash.slice(1)) {
			// No hash was specified -- load a default
			updateHash(
				createHash(getDefaultPageId(getDefaultDocSetId())),
				HashEvent.rename
			);
			processHash();
		} else {
			// An invalid hash was specified -- show an error
			showError(error);
		}
	}

	function showError(error: Error) {
		console.error(error);
		showErrorModal(
			'Oops...',
			h('span', {}, [
				'The URL hash ',
				h('code', {}, location.hash),
				" isn't valid. Click ",
				h('a', { href: '#' }, 'here'),
				' to open the default doc set.'
			])
		);
	}
}

/**
 * Show a message in the error modal
 */
function showErrorModal(heading: string, message: string | HTMLElement) {
	errorModal.querySelector('.error-heading')!.textContent = heading;
	const content = errorModal.querySelector('.error-message')!;
	content.innerHTML = '';
	if (typeof message === 'string') {
		content.textContent = message;
	} else {
		content.appendChild(message);
	}
	errorModal.classList.add('is-active');
}

/**
 * Show a message in the error modal
 */
function hideErrorModal() {
	errorModal.classList.remove('is-active');
}

/**
 * Update the hrefs for the navbar GitHub buttons
 */
function updateGitHubButtons(docs: DocSetId) {
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

	const docs = getCurrentPageId();
	updateHash(
		{
			project: docs.project,
			version: docs.version,
			type: <DocType>viewer.getAttribute('data-doc-type')!,
			page: docs.page,
			section: above.id
		},
		HashEvent.scroll
	);

	highlightActiveSection();

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
