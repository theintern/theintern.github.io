declare const markdownitHeadingAnchor: any;
declare const markdownit: any;

interface DocSetCache {
	name: string;
	markdown: string;
	element: HTMLElement;
	html: string;
}

interface DocSet {
	[version: string]: {
		url: string;
		docBase: string;
		pages: string[];
		cache?: { [name: string]: DocSetCache };
	};
}

interface DocSetId {
	project: string;
	version?: string;
}

interface MenuNode {
	level: number;
	element: Element;
	children: MenuNode[];
}

(() => {
	const docsets: { [name: string]: DocSet } = {
		Intern: {
			v3: {
				url: 'https://github.com/theintern/intern/tree/3.4',
				docBase:
					'https://raw.githubusercontent.com/theintern/intern/3.4/docs/',
				pages: [
					'getting-started.md',
					'fundamentals.md',
					'configuration.md',
					'interfaces.md',
					'unit-testing.md',
					'benchmark-testing.md',
					'functional-testing.md',
					'webdriver-server.md',
					'running.md',
					'reporters.md',
					'ci.md',
					'customisation.md',
					'internals.md',
					'community.md',
					'faq.md'
				]
			},
			v4: {
				url: 'https://github.com/theintern/intern',
				docBase:
					'https://raw.githubusercontent.com/theintern/intern/master/docs/',
				pages: [
					'getting_started.md',
					'how_to.md',
					'architecture.md',
					'concepts.md',
					'configuration.md',
					'writing_tests.md',
					'running.md',
					'api.md'
				]
			}
		},

		'Intern Tutorial': {
			v3: {
				url:
					'https://github.com/theintern/intern-tutorial/tree/intern-3',
				docBase:
					'https://raw.githubusercontent.com/theintern/intern-tutorial/intern-3/',
				pages: ['README.md']
			},
			v4: {
				url: 'https://github.com/theintern/intern-tutorial',
				docBase:
					'https://raw.githubusercontent.com/theintern/intern-tutorial/master/',
				pages: ['README.md']
			}
		}
	};

	let markdown: any;
	let activeDocs: DocSetId | undefined;
	let defaultDocs = { project: 'Intern', version: 'v4' };

	// Super simple router. The location hash fully controls the state of the
	// doc viewer. Changes to the project and version selectors will update the
	// hash, which will cause new content to be rendered.
	window.addEventListener('hashchange', processHash);

	window.addEventListener('load', () => {
		// If the version selector is showing and the user changes it, update
		// the location hash and the docset will be loaded.
		document.querySelector(
			'.docs-nav'
		)!.addEventListener('change', event => {
			const target: Element = <Element>event.target;
			if (target.tagName === 'SELECT') {
				const select = <HTMLSelectElement>target;
				const docs = activeDocs!;

				if (target.getAttribute('data-select-property') === 'project') {
					const versions = Object.keys(docsets[select.value]);
					const docset = getDocset({ project: select.value });
					location.hash = `#${select.value}/${versions[
						versions.length - 1
					]}/${docset.pages[0]}`;
				} else {
					const docset = getDocset({
						project: docs.project,
						version: select.value
					});
					location.hash = `#${docs.project}/${select.value}/${docset
						.pages[0]}`;
				}
			}
		});

		updateProjectSelector();
	});

	// If the base docs page is loaded (without a hash), set a default hash to
	// get a docset to load.
	if (!location.hash) {
		const docset = getDocset(defaultDocs);
		location.hash = `#${defaultDocs.project}/${defaultDocs.version}/${docset
			.pages[0]}`;
	} else {
		processHash();
	}

	/**
	 * Load a docset.
	 *
	 * An optional page and section may be provided. When the docset is
	 * finished loading, the given page, or the first page in the set, will be
	 * shown.
	 */
	function loadDocset(setId: DocSetId) {
		const originalDocs = activeDocs;
		activeDocs = setId;

		const docset = getDocset(setId);
		const pageNames = docset.pages;
		const docBase = docset.docBase;

		let cache = docset.cache!;
		let load: PromiseLike<any>;

		if (!cache) {
			cache = docset.cache = <{ [name: string]: DocSetCache }>{};

			load = Promise.all(
				pageNames.map(name => {
					return (
						cache[name] ||
						fetch(docBase + name)
							.then(response => response.text())
							.then(text => {
								text = filterGhContent(text);
								const html = render(text, name);
								const element = document.createElement('div');
								element.innerHTML = html;

								cache[name] = {
									name: name,
									markdown: text,
									element: element,
									html: html
								};
							})
					);
				})
			);
		} else {
			load = Promise.resolve();
		}

		// Render the other pages in the background
		return load.then(() => {
			if (
				!originalDocs ||
				originalDocs.project !== setId.project ||
				originalDocs.version !== setId.version
			) {
				updateVersionSelector();
				buildMenu();
			}
		});

		function buildMenu() {
			const menu = document.querySelector('.menu-list')!;
			menu.innerHTML = '';

			pageNames.forEach(pageName => {
				const page = cache[pageName];
				let root: MenuNode;
				try {
					root = createNode(page.element.querySelector('h1')!);
				} catch (error) {
					console.log('no h1 on ' + pageName);
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

				// If this document's h1 doesn't have any text (maybe it's just an
				// image), assume this is a README, and use the docset's project
				// name as the title.
				const title = root.element.textContent! || activeDocs!.project;

				const li = createLinkItem(title, pageName);
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

			function createLinkItem(
				text: string,
				pageName: string,
				section?: string
			) {
				const li = document.createElement('li');
				const link = document.createElement('a');
				link.href = createHash(pageName, section);
				link.textContent = text;
				li.appendChild(link);
				return li;
			}

			function createNode(heading: Element) {
				const level = parseInt(heading.tagName.slice(1), 10);
				return { level, element: heading, children: <MenuNode[]>[] };
			}
		}
	}

	/**
	 * Show a page in the currently loaded docset
	 */
	function showPage(name: string, section?: string) {
		const docset = getDocset();
		const page = docset.cache![name];
		const content = document.body.querySelector('.docs-content')!;
		content.innerHTML = '';
		content.appendChild(page.element);

		if (section) {
			document.querySelector(`#${section}`)!.scrollIntoView();
		} else {
			content.scrollTop = 0;
		}

		const menu = document.querySelector('.menu .menu-list')!;
		const active = menu.querySelectorAll('.is-active');
		for (let i = 0; i < active.length; i++) {
			active[i].classList.remove('is-active');
		}

		const items = document.querySelectorAll('.menu .menu-list > li > a');
		const matcher = new RegExp(`/${name}$`);
		for (let i = 0; i < items.length; i++) {
			const item = <HTMLLinkElement>items[i];
			const href = item.href;
			if (matcher.test(href)) {
				item.classList.add('is-active');
				item.parentElement!.classList.add('is-active');
				break;
			}
		}
	}

	/**
	 * Create a link hash for a given page name and fragment for the current
	 * docset
	 */
	function createHash(page: string, section?: string) {
		const docs = activeDocs!;
		const parts = [docs.project, docs.version, page];
		if (section) {
			parts.push(section);
		}
		return '#' + parts.join('/');
	}

	/**
	 * Remove content that may be in the raw GH pages documents that shouldn't
	 * be rendered
	 */
	function filterGhContent(text: string) {
		const markers = [
			/<\!-- vim-markdown-toc[^]*?<!-- vim-markdown-toc -->/,
			/<\!-- start-github-only[^]*?<!-- end-github-only -->/g
		];
		markers.forEach(marker => {
			if (marker.test(text)) {
				text = text.replace(marker, '');
			}
		});
		return text;
	}

	/**
	 * Process the current URL hash value.
	 *
	 * The has has the following format:
	 *
	 *     <project>/<version>/<page>/<section>
	 */
	function processHash() {
		const hash = location.hash.slice(1);
		const parts = hash.split('/').map(part => decodeURIComponent(part));
		const project = parts[0];
		const version = parts[1];
		const page = parts[2];
		const section = parts[3];

		Promise.resolve(loadDocset({ project, version })).then(() => {
			showPage(page, section);
			updateProjectSelector();
			updateVersionSelector();
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
			markdown.renderer.rules.table_open = (
				_tokens: any[],
				_idx: number
			) => {
				return '<table class="table">';
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
				const [base, hash] = href[1].split('#');
				if (!base) {
					href[1] = createHash(env.page, hash);
				} else if (/\.\/.*\.md/.test(base)) {
					href[1] = createHash(base.replace(/^\.\//, ''), hash);
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
	function updateProjectSelector() {
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
			`option[value="${activeDocs!.project}"]`
		);
		if (option) {
			option.selected = true;
		}
		updateGithubLink();
	}

	/**
	 * Update the version selector to show the versions for the currently
	 * active project.
	 */
	function updateVersionSelector() {
		const docs = activeDocs!;
		const versions = Object.keys(docsets[docs.project]);
		const layout = document.querySelector('.docs-layout')!;

		// If more than one version is available, show the version selector
		if (versions.length > 1) {
			layout.classList.add('multi-version');

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
			layout.classList.remove('multi-version');
		}
	}

	/**
	 * Update the github link on the menubar to link to the currently active
	 * project.
	 */
	function updateGithubLink() {
		const link = <HTMLAnchorElement>document.querySelector(
			'.navbar-menu a[data-title="Github"]'
		);
		const docset = getDocset();
		link.href = docset.url;
	}

	/**
	 * Get a docset. If a complete setId is provided, the corresponding docset
	 * is returned. If only a project is specified, the latest version for that
	 * project will be returned. If no docset ID is provided, the currently
	 * active docset will be returned.
	 */
	function getDocset(setId?: DocSetId) {
		const docs = setId || activeDocs!;
		if (!docs.version) {
			const versions = Object.keys(docsets[docs.project]);
			docs.version = versions[versions.length - 1];
		}
		return docsets[docs.project][docs.version];
	}
})();
