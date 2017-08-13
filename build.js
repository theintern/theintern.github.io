var metalsmith = require('metalsmith');
var markdown = require('metalsmith-markdownit');
var layouts = require('metalsmith-layouts');
var handlebars = require('handlebars');

metalsmith(__dirname)
	.metadata({
		site: {
			name: 'The Intern',
			description: "Software testing for humans"
		}
	})
	.source('./src')
	.destination('./public')
	.use(layouts({
		engine: 'handlebars',
		directory: './resources/layouts',
		default: 'default.hbs',
		pattern: "**/*.html",
		partials: "./resources/layouts/partials"
	}))
	.use(markdown())
	.build(function (err) {
		if (err) {
			console.log(err);
		}
		else {
			console.log('Built!');
		}
	});