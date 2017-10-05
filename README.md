# The Intern website

**Please note that the `master` branch contains the built website. Any PRs should be made against the `source` branch.**

## Doc viewer

The doc viewer is a single-page application that loads markdown pages and API data from GitHub and renders documentation on the fly. It must have, at a minimum, a list of project descriptors (described below) that describe where to load doc data from. These descriptors may also contain more detailed information, such as a list of pages to load. The viewer will first load a project's README (this is assumed to always exist) and look for configuration data. If any exists it is merged with the existing doc set descriptor, and any doc pages or API data list in the descriptor are loaded and rendered.

## Documentation descriptors

Project documentation is described in `site/docs.json`. A project descriptor typically looks like:

```js
{
	"url": "https://github.com/theintern/intern",
	"latest": "3",
	"next": "4",
	"versions": {
		"3": {
			"branch": "3.4"
		},
		"4": {
			"branch": "master"
		}
	}
}
```

The entries in "versions" are individual doc sets, identified by the branch name and project URL. The doc set structures can also contain a page list and an API doc location:

```js
{
	"branch": "master",
	"pages": [
		"docs/intro.md",
		"docs/running.md"
	],
	"api": "docs/api.json"
}
```

Doc set data can also be specified in the project README using HTML comments:

```md
# Intern

Intern is great...

<!-- doc-viewer-config
{
    "pages": [
		"docs/intro.md",
		"docs/running.md"
	]
}
-->
```

Note that the doc set descriptor shouldn't have a "branch" property when it's specified in the README.

## Developing

First, run `npm install` to install dependencies.

To start a local testing server, run:

```
npm start
```

To build the site into `public/`, run:

```
npm run build
```

To build a production version of the site with minified/inlined resources, run:

```
npm run build production
```

## Publishing

The site source lives in the `source` branch, while the actual published code is in master. To publish an updated version of the site:

```
npm run publish
```

The `publish` script will clone this repo into the `public/` subdirectory and check out the `master` branch, build the site into it, commit the changes, and pull those changes back into this instance of the repo, then push the changes to origin:master. If you'd like to publish to a branch other than origin, do

```
npm run publish remote=my_remote
```

If you'd like to skip the push step, do

```
npm run publish remote=
```

## Credits

The Intern version badghes were generated at https://shields.io with https://img.shields.io/badge/intern-v4-green.svg?colorB=2EC186.

© [SitePen, Inc.](http://sitepen.com) and its [contributors](https://github.com/theintern/theintern.github.io/graphs/contributors)
