import { parseHash } from './hash';

export type DocType = 'api' | 'docs';

export interface DocSet {
	url: string;
	latest: string;
	next: string;
	versions: { [version: string]: Docs };
}

/**
 * Details for a specific version of a docset. If a branch is specified but url
 * or docBase are not, they will be constructed using the standard GitHub URL
 * format.
 */
export interface Docs {
	// The base URL for the docset
	url?: string;
	// The base URL from which the pages should be loaded
	docBase?: string;
	// The branch or tag in the repo where docs will be loaded from.
	branch?: string;
	// The path to an API data file
	api?: string;

	// The paths to  markdown pages that make up the docset, relative to
	// docBase
	pages: string[];
	// A cache of rendered documents
	pageCache?: { [name: string]: DocPage };

	// The IDs of generated API pages
	apiPages?: string[];
	// A cache of rendered api doc pages
	apiCache?: { [name: string]: DocPage };

	// The rendered menu element
	menu?: Element;
	// The rendered api menu element
	apiMenu?: Element;
}

export interface DocPage {
	name: string;
	element: Element;
	title: string;
}

export interface DocSetId {
	project: string;
	version: string;
}

export interface DocSetInfo {
	project: string;
	version: string;
	docs: Docs;
}

export interface DocInfo {
	project: string;
	version: string;
	type: DocType;
	page: string;
	section: string;
}

/**
 * Get information about the currently displayed docset. If the location hash
 * does not identify a page, use default values.
 */
export function getDocInfo() {
	const data = parseHash();

	if (!data.project) {
		data.project = defaultDocs.project;
	}

	if (!data.version) {
		if (data.project === defaultDocs.project) {
			data.version = defaultDocs.version;
		} else {
			data.version = docsets[data.project].latest;
		}
	}

	if (!data.type) {
		data.type = 'docs';
	}

	if (!data.page) {
		const docs = docsets[data.project].versions[data.version];
		if (data.type === 'docs') {
			data.page = docs.pages[0];
		} else {
			data.page = docs.apiPages ? docs.apiPages[0] : '';
		}
	}

	return data;
}

/**
 * Get a docset. If a complete setId is provided, the corresponding docset
 * is returned. If only a project is specified, the latest version for that
 * project will be returned. If no docset ID is provided, the currently
 * active docset will be returned.
 */
export function getDocSet(setId?: DocSetId): DocSetInfo | undefined {
	const docs = setId || getDocInfo();
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
		docs: project.versions[docs.version]
	};
}

/**
 * Get the project base URL for a given project version. If the docset
 * version structure contains a `url` field, it will be used. Otherwise, a
 * URL will be constructed using the docset version branch and standard
 * GitHub URL formats.
 */
export function getDocVersionUrl(info: { project: string; version: string }) {
	const docset = docsets[info.project];
	const dv = docset.versions[info.version];
	if (dv.url) {
		return dv.url;
	}
	return `${docset.url}/tree/${dv.branch}`;
}

/**
 * Get the doc base URL for a given project version. If the docset version
 * structure contains a `docBase` field, it will be used. Otherwise, a URL
 * will be constructed using the docset version branch and standard GitHub
 * URL formats.
 */
export function getDocBaseUrl(info: { project: string; version: string }) {
	const docset = docsets[info.project];
	const dv = docset.versions[info.version];
	if (dv.docBase) {
		return dv.docBase;
	}
	const url = docset.url.replace(/\/\/github\./, '//raw.githubusercontent.');

	return `${url}/${dv.branch}/`;
}

/**
 * Return the 'latest' version of a given project. This may be the highest
 * version number, or the version tagged as the 'latest' in the docset data.
 */
export function getLatestVersion(project: string) {
	const docset = docsets[project];
	let version = docset.latest;
	if (!version) {
		const versions = Object.keys(docset.versions);
		version = versions[versions.length - 1];
	}
	return { version, docs: docset.versions[version] };
}

/**
 * Return the 'next' version of a given project. This may be the version
 * directly after the 'latest' version, or the version tagged as 'next' in the
 * docset data.
 */
export function getNextVersion(project: string) {
	const docset = docsets[project];
	let version = docset.next;
	if (!version) {
		const versions = Object.keys(docset.versions);
		const latest = getLatestVersion(project).version;
		const idx = versions.indexOf(latest);
		if (idx !== -1 && versions[idx + 1]) {
			version = versions[idx + 1];
		}
	}
	return { version, docs: docset.versions[version] };
}

/**
 * Return a list of available project names
 */
export function getProjects() {
	return Object.keys(docsets);
}

/**
 * Return a list of available versions for a given project
 */
export function getVersions(project: string) {
	return Object.keys(docsets[project].versions);
}

/**
 * Return the base URL for a project
 */
export function getProjectUrl(project: string) {
	return docsets[project].url;
}

declare const docsets: { [name: string]: DocSet };

const defaultDocs = {
	project: 'Intern',
	version: docsets['Intern'].latest
};
