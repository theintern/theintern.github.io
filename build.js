const metalsmith = require('metalsmith');
const markdown = require('metalsmith-markdownit');
const layouts = require('metalsmith-layouts');
const ejs = require('ejs');
const sass = require('metalsmith-sass');
const watch = require('metalsmith-watch');
const serve = require('metalsmith-serve');
const assets = require('metalsmith-assets');
const inlineSource = require('metalsmith-inline-source');

metalsmith(__dirname)
	.metadata({
		site: {
			name: 'The Intern',
			description: "Software testing for humans"
		}
	})
	.source('./src')
	.destination('./public')
	.use(markdown())
	.use(layouts({
		engine: 'ejs',
		directory: __dirname+'/resources/layouts',
		default: 'default.ejs',
		pattern: "**/*.html",
		partials: __dirname+"resources/layouts/partials"
	}))
	.use(sass({
		outputStyle: "compressed",
		sourceMap: true,
		sourceMapContents: true
	}))
	.use(inlineSource({
		rootpath: './src/'
	}))
	.use(assets({
		source: './resources/assets',
		destination: './resources/assets'
	}))
	.use(serve({
		port: 4000,
		verbose: true
	}))
	.use(watch({
			paths: {
				"${source}/**/*": true,
				"layouts/**/*": "**/*.ejs",
			},
			livereload: true,
		})
	)
	.build(function (err) {
		if (err) {
			console.log(err);
		}
		else {
			console.log('Built!');
		}
	});