import { DocSetId, DocType, PageId, isValidPageId } from './docs';

/**
 * Create a link hash for a given docset
 */
export function createHash(id: (DocSetId & { type: DocType }) | PageId) {
	const parts = [id.project, id.version, id.type];
	if (isValidPageId(id)) {
		parts.push(id.page);
		if (id.section) {
			parts.push(id.section);
		}
	}
	return '#' + parts.map(encodeURIComponent).join('/');
}

/**
 * Parse the hash into a DocId
 */
export function parseHash() {
	const hash = location.hash.slice(1);
	let [project, version, type, page, section] = hash
		.split('/')
		.map(part => decodeURIComponent(part));
	return <PageId>{ project, version, type, page, section };
}
