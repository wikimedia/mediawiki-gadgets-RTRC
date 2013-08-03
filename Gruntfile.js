/*jshint node:true */
module.exports = function (grunt) {
	var isRelease = false;
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-contrib-uglify');
	grunt.loadNpmTasks('grunt-contrib-watch');

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		jshint: {
			all: ['*.js', 'src/*.js']
		},
		uglify: {
			all: {
				files: {
					'dist/rtrc.min.js': ['src/rtrc.js']
				},
				options: {
					report: 'min',
					compress: true,
					mangle: true,
					banner: '/*! RTRC v<%= pkg.version %> | krinkle.mit-license.org */\n'
				}
			}
		},
		watch: {
			files: ['<%= jshint.all %>', '.{jshintrc,jshintignore}'],
			tasks: ['test', 'build']
		}
	});

	grunt.registerTask('onrelease', function () {
		isRelease = true;
	});

	grunt.registerTask('onbuild', function () {
		var done;
		if (isRelease) {
			return;
		}
		done = this.async();
		require('child_process').exec('git rev-parse HEAD', function (err, stout, stderr) {
			if (!stout || err || stderr) {
				grunt.log.err(err || stderr);
				done(false);
				return;
			}
			grunt.config.set('pkg.version', grunt.config('pkg.version') + '-pre (' + stout.substr(0, 10) + ')');
			grunt.verbose.writeln('Added git HEAD to pgk.version');
			done();
		});
	});

	grunt.registerTask('test', ['jshint']);
	grunt.registerTask('build', ['onbuild', 'uglify']);
	grunt.registerTask('release', ['onrelease', 'test', 'build']);

	grunt.registerTask('default', ['test', 'build']);
};
