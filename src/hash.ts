import { DocInfo, getDocInfo } from './docs';

/**
 * Create a link hash for a given docset.
 */
export function createHash(info: Partial<DocInfo>) {
	const currentDocs = getDocInfo();
	const docs = {
		project: currentDocs.project,
		version: currentDocs.version,
		type: 'docs',
		...info
	};
	const parts = [docs.project, docs.version, docs.type];
	if (docs.page) {
		parts.push(docs.page);

		if (docs.section) {
			parts.push(docs.section);
		}
	}
	return '#' + parts.map(encodeURIComponent).join('/');
}

/**
 * Parse the hash into a DocInfo structure.
 */
export function parseHash(): DocInfo {
	const hash = location.hash.slice(1);
	let [project, version, type, page, section] = hash
		.split('/')
		.map(part => decodeURIComponent(part));
	return <DocInfo>{ project, version, type, page, section };
}
