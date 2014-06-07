/*jshint node:true */
module.exports = function (grunt) {
	grunt.loadNpmTasks('grunt-compare-size');
	grunt.loadNpmTasks('grunt-contrib-clean');
	grunt.loadNpmTasks('grunt-contrib-concat');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-contrib-watch');
	grunt.loadNpmTasks('grunt-jscs-checker');

	grunt.renameTask('compare_size', 'compareSize');

	grunt.initConfig({
		clean: {
			dist: 'tmp/*'
		},
		concat: {
			src: {
				src: 'src/*',
				dest: 'tmp/rtrc.concat'
			}
		},
		compareSize: {
			files: [
				'src/*',
				'tmp/rtrc.concat'
			],
			options: {
				// Location of stored size data
				cache: '.sizecache.json',

				// Compressor label-function pairs
				compress: {
					gz: function (fileContents) {
						return require('gzip-js').zip(fileContents, {}).length;
					}
				}
			}
		},
		jshint: {
			options: {
				jshintrc: true
			},
			all: [
				'*.js',
				'src/*.js'
			]
		},
		jscs: {
			all: '<%= jshint.all %>'
		},
		watch: {
			files: [
				'.{jscsrc,jshintrc,jshintignore}',
				'<%= jshint.all %>'
			],
			tasks: 'test'
		}
	});

	grunt.registerTask('test', ['jshint', 'jscs']);
	grunt.registerTask('compare', ['clean', 'concat', 'compareSize']);
	grunt.registerTask('default', ['test', 'compare']);
};
