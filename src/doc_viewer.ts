interface DocSet {
	url: string;
	latest: string;
	next: string;
	versions: {
		[version: string]: {
			// The project URL
			url: string;
			// The base URL from which the pages should be loaded
			docBase: string;
			// The markdown pages that make up the docset
			pages: string[];
			// A cache of rendered documents
			cache?: { [name: string]: DocPage };
			// The rendered menu element
			menu?: Element;
		};
	};
}

interface DocPage {
	element: Element;
	title: string;
}

interface DocSetId {
	project: string;
	version?: string;
}

interface DocInfo {
	project: string;
	version: string;
	page: string;
	section: string;
}

interface MenuNode {
	level: number;
	element: Element;
	children: MenuNode[];
}

interface SearchResult {
	element: Element;
	section?: string;
	snippet: string;
}

declare const markdownitHeadingAnchor: any;
declare const markdownit: any;
declare const docsets: { [name: string]: DocSet };
declare const Mark: any;

/**
 * Called when all necessary polyfills have been loaded
 */
function polyfilled() {
	let markdown: any;
	let defaultDocs = { project: 'Intern' };
	let skipPageLoad = false;
	let ignoreScroll = false;
	let highlightTerm: string | undefined;

	const maxSnippetLength = 60;
	const searchDelay = 300;
	const menuHighlightDelay = 20;

	// Super simple router. The location hash fully controls the state of the
	// doc viewer. Changes to the project and version selectors will update the
	// hash, which will cause new content to be rendered.
	window.addEventListener('hashchange', processHash);

	// If the base docs page is loaded (without a hash), set a default hash to
	// get a docset to load.
	if (!location.hash) {
		const docset = getDocset(defaultDocs)!;
		const hash = createHash({
			project: docset.project,
			version: docset.version,
			page: docset.data.pages[0]
		});
		updateHash(hash);
	} else {
		processHash();
	}

	const ready = new Promise(resolve => {
		window.addEventListener('load', resolve);
	});

	// Run when the page has been rendered
	ready.then(() => {
		// Toggle the doc selector when the header is clicked
		const docsetSelect = document.querySelector('.menu .docset-selector')!;
		const docsetSelectHeader = docsetSelect.querySelector('.card-header')!;
		docsetSelectHeader.addEventListener('click', function() {
			docsetSelect.classList.toggle('is-active');
		});
		docsetSelect.addEventListener('change', function() {
			docsetSelect.classList.remove('is-active');
		});

		// Handle updates to the project + version selects.
		document.querySelector(
			'.docs-nav'
		)!.addEventListener('change', event => {
			const target: Element = <Element>event.target;
			if (target.tagName === 'SELECT') {
				const select = <HTMLSelectElement>target;
				const docs = getCurrentDocs();

				if (target.getAttribute('data-select-property') === 'project') {
					const docset = getDocset({ project: select.value })!.data;
					updateHash(
						createHash({
							project: select.value,
							version: docsets[select.value].latest,
							page: docset.pages[0]
						})
					);
				} else {
					const docset = getDocset({
						project: docs.project,
						version: select.value
					})!.data;
					updateHash(
						createHash({
							project: docs.project,
							version: select.value,
							page: docset.pages[0]
						})
					);
				}
			}
		});

		// Live search as the user types into the search dropdown input
		let searchTimer: number | undefined;
		document.querySelector(
			'.menu .search-field'
		)!.addEventListener('input', event => {
			const value = (<HTMLInputElement>event.target).value;
			if (searchTimer) {
				clearTimeout(searchTimer);
			}
			searchTimer = setTimeout(() => {
				search(value);
			}, searchDelay);
		});

		document.querySelector(
			'.menu .search-field .button'
		)!.addEventListener('click', () => {
			const input = <HTMLInputElement>document.querySelector(
				'.menu .search-field input'
			);
			input.value = '';
			search('');
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
			menuTimer = setTimeout(() => {
				menuTimer = undefined;
				updateHashFromContent();
			}, menuHighlightDelay);
		});

		updateDocsetSelector();
	});

	function updateHash(newHash: string, ignoreUpdate = false) {
		if (ignoreUpdate && location.hash !== newHash) {
			skipPageLoad = true;
		}
		location.hash = newHash;
	}

	/**
	 * Load a docset.
	 *
	 * An optional page and section may be provided. When the docset is
	 * finished loading, the given page, or the first page in the set, will be
	 * shown.
	 */
	function loadDocset(setId: DocSetId) {
		const docset = getDocset(setId)!;
		const container = document.querySelector('.docs-content')!;

		if (
			container &&
			container.getAttribute('data-doc-project') === docset.project &&
			container.getAttribute('data-doc-version') === docset.version
		) {
			// The docset is already visible, so don't do anything
			return;
		}

		const pageNames = docset.data.pages;
		const docBase = docset.data.docBase;

		let cache = docset.data.cache!;
		let load: PromiseLike<any>;

		if (!cache) {
			// The docset hasn't been loaded yet
			cache = docset.data.cache = <{ [name: string]: DocPage }>{};

			load = Promise.all(
				pageNames.map(name => {
					return (
						cache[name] ||
						fetch(docBase + name)
							.then(response => response.text())
							.then(text => {
								return ready.then(() => {
									text = filterGhContent(text);
									const html = render(text, name);
									const element = document.createElement(
										'div'
									);
									element.innerHTML = html;
									const h1 = element.querySelector('h1')!;
									const title =
										(h1 && h1.textContent) ||
										docset.project;
									cache[name] = { element, title };
								});
							})
					);
				})
			).then(() => {
				createMenu();
			});
		} else {
			// The docset is already loaded
			load = Promise.resolve();
		}

		return Promise.all([ready, load]).then(() => {
			const container = document.querySelector('.docs-content')!;
			container.setAttribute('data-doc-project', docset.project);
			container.setAttribute('data-doc-version', docset.version);

			updateDocsetSelector();
			updateDocsetName();
			showMenu();
		});

		// Remove content that may be in the raw GH pages documents that
		// shouldn't
		function filterGhContent(text: string) {
			// This would be simpler with regular expressions, but that makes IE10
			// sad.
			const markers = [
				['<!-- vim-markdown-toc GFM -->', '<!-- vim-markdown-toc -->'],
				['<!-- start-github-only -->', '<!-- end-github-only -->']
			];
			return markers.reduce((text, marker) => {
				const chunks = [];
				let start = 0;
				let left = text.indexOf(marker[0]);
				let right = 0;
				while (left !== -1) {
					chunks.push(text.slice(start, left));
					right = text.indexOf(marker[1], left);
					if (right === -1) {
						break;
					}
					start = right + marker[1].length + 1;
					left = text.indexOf(marker[0], start);
				}
				if (right !== -1) {
					chunks.push(text.slice(start));
				}
				return chunks.join('');
			}, text);
		}

		// Create the sidebar menu for a page
		function createMenu() {
			const menu = document.createElement('ul');
			menu.className = 'menu-list';
			docset.data.menu = menu;

			pageNames.forEach(pageName => {
				const page = cache[pageName];
				let root: MenuNode;
				try {
					root = createNode(page.element.querySelector('h1')!);
				} catch (error) {
					root = {
						level: 1,
						element: document.createElement('li'),
						children: []
					};
				}
				const headings = page.element.querySelectorAll('h2,h3')!;
				const stack: MenuNode[][] = <MenuNode[][]>[[root]];
				let children: MenuNode[];

				for (let i = 0; i < headings.length; i++) {
					let heading = headings[i];
					let newNode = createNode(heading);
					let level = newNode.level;

					if (level === stack[0][0].level) {
						stack[0].unshift(newNode);
					} else if (level > stack[0][0].level) {
						stack.unshift([newNode]);
					} else {
						while (stack[0][0].level > level) {
							children = stack.shift()!.reverse();
							stack[0][0].children = children;
						}
						if (level === stack[0][0].level) {
							stack[0].unshift(newNode);
						} else {
							stack.unshift([newNode]);
						}
					}
				}

				while (stack.length > 1) {
					children = stack.shift()!.reverse();
					stack[0][0].children = children;
				}

				const li = createLinkItem(page.title, pageName);
				if (root.children.length > 0) {
					li.appendChild(createSubMenu(root.children, pageName));
				}

				menu.appendChild(li);
			});

			function createSubMenu(children: MenuNode[], pageName: string) {
				const ul = document.createElement('ul');

				children.forEach(child => {
					const heading = child.element;
					const li = createLinkItem(
						heading.textContent!,
						pageName,
						heading.id
					);
					if (child.children.length > 0) {
						li.appendChild(createSubMenu(child.children, pageName));
					}
					ul.appendChild(li);
				});

				return ul;
			}

			function createNode(heading: Element) {
				const level = parseInt(heading.tagName.slice(1), 10);
				return { level, element: heading, children: <MenuNode[]>[] };
			}
		}

		// Install the current docset's menu in the menu container
		function showMenu() {
			const menu = document.querySelector(
				'.docs-nav .menu .docset-contents'
			)!;
			const menuList = menu.querySelector('.menu-list');
			if (menuList) {
				menu.removeChild(menuList);
			}
			menu.appendChild(docset.data.menu!);
		}
	}

	/**
	 * Create a link item for a menu
	 */
	function createLinkItem(text: string, pageName: string, section?: string) {
		const li = document.createElement('li');
		const link = document.createElement('a');
		link.href = createHash({ page: pageName, section });
		link.textContent = text;
		link.title = text;
		li.appendChild(link);
		return li;
	}

	/**
	 * Show a page in the currently loaded docset
	 */
	function showPage(name: string, section?: string) {
		const docset = getDocset()!.data;
		const page = docset.cache![name];
		const content = <HTMLElement>document.body.querySelector('.docs-content')!;
		content.removeChild(content.children[0]);
		content.appendChild(page.element);
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

		updatePageMenu();
		updateSidebarHighlight();
	}

	/**
	 * Update the active element in the menu
	 */
	function updatePageMenu() {
		const menu = document.querySelector(
			'.menu .docset-contents .menu-list'
		)!;
		const active = menu.querySelector('.is-active-page');
		if (active) {
			active.classList.remove('is-active-page');
		}

		const currentDocs = getCurrentDocs();
		const currentPage = createHash({
			project: currentDocs.project,
			version: currentDocs.version,
			page: currentDocs.page
		});

		const pageLink = menu.querySelector(`li > a[href="${currentPage}"]`)!;
		pageLink.parentElement!.classList.add('is-active-page');
	}

	/**
	 * Update the active element in the menu
	 */
	function updateSidebarHighlight() {
		const menus = document.querySelectorAll('.menu .menu-list')!;
		if (menus.length === 0) {
			return;
		}

		for (let i = 0; i < menus.length; i++) {
			const menu = menus[i];
			const active = menu.querySelector('.is-active');
			if (active) {
				active.classList.remove('is-active');
			}

			const currentSection = location.hash;
			let link = <HTMLElement>menu.querySelector(`li > a[href="${currentSection}"]`)!;
			if (!link) {
				const currentDocs = getCurrentDocs();
				const currentPage = createHash({
					project: currentDocs.project,
					version: currentDocs.version,
					page: currentDocs.page
				});
				link = <HTMLElement>menu.querySelector(`li > a[href="${currentPage}"]`)!;
			}

			if (link) {
				link.classList.add('is-active');
				scrollIntoViewIfNessary(
					link,
					<HTMLElement>document.querySelector('.docs-nav')!
				);
			}
		}
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
		updateSidebarHighlight();

		if (ignoring) {
			return;
		}

		const hash = decodeHash();
		const parts = hash.split('/').map(part => decodeURIComponent(part));
		const project = parts[0];
		const version = parts[1];
		const docset = getDocset({ project, version })!;
		const page = parts[2] || docset.data.pages[0];
		const section = parts[3];

		// The hash encodes our state -- ensure it points to a valid docset
		if (!version) {
			const parts: Partial<DocInfo> = {
				project: docset.project,
				version: docset.version
			};
			if (page) {
				parts.page = page;
			}
			if (section) {
				parts.section = section;
			}
			updateHash(createHash(parts));
		}

		Promise.resolve(loadDocset({ project, version })).then(() => {
			showPage(page, section);
			updateDocsetSelector();
		});
	}

	/**
	 * Render markdown into HTML. Lazily initialize the markdown renderer.
	 */
	function render(text: string, page?: string) {
		if (!markdown) {
			markdown = markdownit({
				// Customize the syntax highlighting process
				highlight: (str: string, lang: string) => {
					if (lang && hljs.getLanguage(lang)) {
						try {
							return (
								'<pre><code class="hljs language-' +
								lang +
								'">' +
								hljs.highlight(lang, str, true).value +
								'</code></pre>'
							);
						} catch (error) {
							console.error(error);
						}
					}

					return '<pre><code class="hljs">' + str + '</code></pre>';
				},

				// allow HTML in markdown to pass through
				html: true
			});

			// Add 'table' class to tables
			markdown.renderer.rules.table_open = () => {
				return '<table class="table is-bordered">';
			};

			markdown.renderer.rules.thead_open = (
				tokens: any[],
				idx: number
			) => {
				let i = idx + 2;
				let token = tokens[i];
				let empty = true;
				while (token && token.type !== 'tr_close') {
					let token2 = tokens[i + 2];
					if (
						token.type !== 'th_open' ||
						!token2 ||
						token2.type !== 'th_close'
					) {
						empty = false;
						break;
					}
					let token1 = tokens[i + 1];
					if (
						token1.type !== 'inline' ||
						token1.children.length > 0
					) {
						empty = false;
						break;
					}
					i += 3;
					token = tokens[i];
				}
				return `<thead${empty ? ' class="is-hidden"' : ''}>`;
			};

			// Style blockquotes that are used for warning or info asides
			markdown.renderer.rules.blockquote_open = (
				tokens: any[],
				idx: number
			) => {
				// Get the token representing the first chunk of the block
				// quote
				const token = tokens[idx + 2].children[0];

				const warning = '⚠️';
				const info = '💡';
				const deprecated = '👎';

				if (token.content.indexOf(warning) === 0) {
					token.content = token.content
						.replace(warning, '')
						.replace(/^\s*/, '');
					return '<blockquote class="warning"><div><i class="fa fa-warning" aria-hidden="true"></i></div>';
				} else if (token.content.indexOf(info) === 0) {
					token.content = token.content
						.replace(info, '')
						.replace(/^\s*/, '');
					return '<blockquote class="info"><div><i class="fa fa-lightbulb-o" aria-hidden="true"></i></div>';
				} else if (token.content.indexOf(deprecated) === 0) {
					token.content = token.content
						.replace(deprecated, '')
						.replace(/^\s*/, '');
					return '<blockquote class="deprecated"><div><i class="fa fa-thumbs-o-down" aria-hidden="true"></i></div>';
				}

				return '<blockquote>';
			};

			// Update relative links to markdown files
			const defaultLinkRender =
				markdown.renderer.rules.link_open ||
				((
					tokens: any[],
					idx: number,
					options: any,
					_env: any,
					self: any
				) => {
					return self.renderToken(tokens, idx, options);
				});
			markdown.renderer.rules.link_open = (
				tokens: any[],
				idx: number,
				options: any,
				env: any,
				self: any
			) => {
				const hrefIdx = tokens[idx].attrIndex('href');
				const href = tokens[idx].attrs[hrefIdx];
				const [file, hash] = href[1].split('#');
				if (!file) {
					// This is an in-page anchor link
					href[1] = createHash({ page: env.page, section: hash });
				} else if (/\.md/.test(file) && !/\/\//.test(file)) {
					// This is a link to a local markdown file. Make a hash
					// link that's relative to the current page.
					const cleanFile = file.replace(/^\.\//, '');
					let pageBase = '';
					if (env.page.indexOf('/') !== -1) {
						pageBase = env.page.slice(
							0,
							env.page.lastIndexOf('/') + 1
						);
					}
					href[1] = createHash({
						page: pageBase + cleanFile,
						section: hash
					});
				}
				return defaultLinkRender(tokens, idx, options, env, self);
			};

			// Generate heading anchors with the same format as GitHub pages
			// (this isn't terribly robust yet)
			markdown.use(markdownitHeadingAnchor, {
				slugify: (str: string) => {
					return str
						.toLowerCase()
						.replace(/[^A-Za-z0-9_ ]/g, '')
						.replace(/\s+/g, '-');
				}
			});
		}

		return markdown.render(text, { page });
	}

	/**
	 * Select the currently active project in the project selector.
	 */
	function updateDocsetSelector() {
		const docs = getCurrentDocs();
		const selector = document.querySelector(
			'select[data-select-property="project"]'
		)!;

		if (selector.children.length === 0) {
			Object.keys(docsets).forEach(name => {
				const option = document.createElement('option');
				option.value = name;
				option.textContent = name;
				selector.appendChild(option);
			});
		}

		const option = <HTMLOptionElement>selector.querySelector(
			`option[value="${getCurrentDocs().project}"]`
		);
		if (option) {
			option.selected = true;
		}

		const versions = Object.keys(docsets[docs.project].versions);
		// If more than one version is available, show the version selector
		if (versions.length > 1) {
			addViewClass('multi-version');

			const selector = document.querySelector(
				'select[data-select-property="version"]'
			)!;
			selector.innerHTML = '';
			versions.forEach(version => {
				const option = document.createElement('option');
				option.value = version;
				option.selected = version === docs.version;
				option.textContent = version;
				selector.appendChild(option);
			});
		} else {
			removeViewClass('multi-version');
		}

		updateDocsetName();
		updateGithubLink();
	}

	/**
	 * Update the docset name in the sidebar to reflect the project and version
	 * selectors
	 */
	function updateDocsetName() {
		const docs = getCurrentDocs();
		const docsetSelector = document.querySelector(
			'.menu .docset-selector'
		)!;

		const project = docsetSelector.querySelector('.project')!;
		project.textContent = docs.project;

		const version = docsetSelector.querySelector('.version')!;
		version.textContent = docs.version;
	}

	/**
	 * Update the github link on the menubar to link to the currently active
	 * project.
	 */
	function updateGithubLink() {
		const link = <HTMLAnchorElement>document.querySelector(
			'.navbar-menu a[data-title="Github"]'
		);
		const docset = getDocset()!.data;
		link.href = docset.url;
	}

	/**
	 * Get the current docset from the location hash. If the hash does not identify a page, use default values.
	 */
	function getCurrentDocs(): DocInfo {
		const hash = decodeHash();
		let [project, version, page, section] = hash
			.split('/')
			.map(part => decodeURIComponent(part));
		if (!project) {
			project = defaultDocs.project;
		}
		if (!version) {
			version = docsets[project].latest;
		}
		if (!page) {
			page = docsets[project].versions[version].pages[0];
		}
		return {
			project,
			version,
			page,
			section
		};
	}

	/**
	 * Create a link hash for a given page name and fragment for the current
	 * docset.
	 *
	 * If this is changed, update decodeHash to match.
	 */
	function createHash(info: Partial<DocInfo>) {
		const currentDocs = getCurrentDocs();
		const docs = { ...info };
		if (!docs.project) {
			docs.project = currentDocs.project;
		}
		if (!docs.version) {
			docs.version = currentDocs.version;
		}
		// if (!docs.page) {
		// 	docs.page = docsets[docs.project].versions[docs.version].pages[0];
		// }
		const parts = [docs.project, docs.version, docs.page];
		if (docs.section) {
			parts.push(docs.section);
		}
		return '#' + parts.map(encodeURIComponent).join('/');
	}

	/**
	 * Return a decoded version of the hash.
	 *
	 * If this is changed, update createHash to match.
	 */
	function decodeHash() {
		return location.hash.slice(1);
	}

	/**
	 * Get a docset. If a complete setId is provided, the corresponding docset
	 * is returned. If only a project is specified, the latest version for that
	 * project will be returned. If no docset ID is provided, the currently
	 * active docset will be returned.
	 */
	function getDocset(setId?: DocSetId) {
		const docs = setId || getCurrentDocs();
		const project = docsets[docs.project];
		if (!project) {
			return;
		}

		if (!docs.version) {
			docs.version = project.latest;
		}

		return {
			project: docs.project,
			version: docs.version!,
			data: project.versions[docs.version]
		};
	}

	/**
	 * Search the loaded docset for a given string. Update the search results
	 * box with the results.
	 */
	function search(term: string) {
		const searchResults = document.querySelector(
			'.menu .search-results .menu-list'
		)!;
		searchResults.innerHTML = '';

		highlightTerm = term.trim();
		const searchTerm = highlightTerm.toLowerCase();

		if (highlightTerm) {
			addViewClass('search-is-active');
		} else {
			removeViewClass('search-is-active');
			updateHashFromContent();
		}

		const docset = getDocset()!;
		const finders: PromiseLike<any>[] = [];
		for (let name in docset.data.cache!) {
			const page = docset.data.cache![name];
			finders.push(findAllMatches(page.element).then(matches => {
				if (matches.length > 0) {
					const link = createLinkItem(page.title, name);
					searchResults.appendChild(link);

					const submenu = document.createElement('ul');
					link.appendChild(submenu);

					matches.forEach(match => {
						const link = createLinkItem(
							match.snippet,
							name,
							match.section
						);
						submenu.appendChild(link);
					});
				}
			}));
		}

		Promise.all(finders).then(() => {
			if (searchResults.childNodes.length === 0) {
				searchResults.innerHTML = '<div class="no-results">No results found</div>';
			}
		});

		// Find all the matches for the user's text
		function findAllMatches(page: Element): Promise<SearchResult[]> {
			return new Promise(resolve => {
				const highlighter = new Mark(page);
				highlighter.unmark();

				const matches: SearchResult[] = [];
				highlighter.mark(searchTerm, {
					acrossElements: true,
					caseSensitive: false,
					ignorePunctuation: ['“', '”', '‘', '’'],
					separateWordSearch: false,
					each: (element: Element) => {
						element.id = `search-result-${matches.length}`;
						matches.push({
							element,
							section: element.id,
							snippet: createSnippet(element)
						});
					},
					done: () => {
						resolve(matches);
					}
				});
			});
		}

		// Get some text surrounding a search match
		function createSnippet(searchMatch: Element) {
			const searchText = searchMatch.textContent!;
			const container = getContainer(searchMatch);

			let previousText = '';
			let previous = getNextTextNode(
				searchMatch,
				previousSibling,
				getRightLeaf
			);
			while (previous && previousText.length <= 10) {
				previousText = previous.textContent! + previousText;
				previous = getNextTextNode(
					previous,
					previousSibling,
					getRightLeaf
				)!;
			}

			let nextTextLength =
				maxSnippetLength -
				Math.min(previousText.length, 10) -
				searchText.length;
			let nextText = '';
			let next = getNextTextNode(searchMatch, nextSibling, getLeftLeaf);
			while (next && nextText.length < nextTextLength) {
				nextText += next.textContent!;
				next = getNextTextNode(next, nextSibling, getLeftLeaf);
			}

			if (previousText.length > 10) {
				previousText = `...${previousText.slice(
					previousText.length - 10
				)}`;
			}
			if (nextText.length > nextTextLength) {
				nextText = `${nextText.slice(0, nextTextLength)}...`;
			}

			return [previousText, searchText, nextText].join('');

			function getNextTextNode(
				node: Node | null,
				getNext: (node: Node) => Node | null,
				getLeaf: (node: Node) => Node | null
			): Node | null {
				if (!node || node === container) {
					return null;
				}

				let next = getNext(node);
				if (!next) {
					return getNextTextNode(
						node.parentElement,
						getNext,
						getLeaf
					);
				}

				if (next.childNodes.length > 0) {
					next = getLeaf(next);
				}

				if (next && next.nodeType !== Node.TEXT_NODE) {
					return getNextTextNode(next, getNext, getLeaf);
				}

				return next;
			}

			function nextSibling(node: Node) {
				return node.nextSibling;
			}

			function previousSibling(node: Node) {
				return node.previousSibling;
			}

			function getLeftLeaf(node: Node): Node {
				while (node.childNodes.length > 0) {
					return getLeftLeaf(node.childNodes[0]);
				}
				return node;
			}

			function getRightLeaf(node: Node): Node {
				while (node.childNodes.length > 0) {
					return getRightLeaf(
						node.childNodes[node.childNodes.length - 1]
					);
				}
				return node;
			}

			function getContainer(node: Element): Element {
				switch (node.tagName) {
					case 'H1':
					case 'H2':
					case 'H3':
					case 'H4':
					case 'P':
					case 'BLOCKQUOTE':
					case 'PRE':
					case 'LI':
					case 'TR':
					case 'TABLE':
						return node;
					default:
						return getContainer(node.parentElement!);
				}
			}
		}
	}

	function addViewClass(className: string) {
		const layout = document.querySelector('.docs-layout')!;
		layout.classList.add(className);
	}

	function removeViewClass(className: string) {
		const layout = document.querySelector('.docs-layout')!;
		layout.classList.remove(className);
	}

	function hasViewClass(className: string) {
		const layout = document.querySelector('.docs-layout')!;
		return layout.classList.contains(className);
	}

	function scrollIntoViewIfNessary(
		element: HTMLElement,
		container: HTMLElement
	) {
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

	function updateHashFromContent() {
		const content = <HTMLElement>document.querySelector('.docs-content')!;
		let elements: NodeListOf<Element>;
		if (hasViewClass('search-is-active')) {
			elements = content.querySelectorAll('mark')!;
		} else {
			elements = content.querySelectorAll('h1,h2,h3')!;
		}

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

		const docs = getCurrentDocs();
		updateHash(
			createHash({
				project: docs.project,
				version: docs.version,
				page: docs.page,
				section: above.id
			}),
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
}
