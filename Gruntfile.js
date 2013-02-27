/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2012 webinos
 ******************************************************************************/

module.exports = function(grunt) {

  var fs = require('fs');
  var os = require('os');
  var path = require('path');

  grunt.initConfig({
    // config props
    generated: {
      normal: 'webinos/web_root/webinos.js',
      min: 'webinos/web_root/webinos.min.js'
    },
    // dir names to exclude from "clean-certs" target
    excludepaths: ['auth_api', 'context_manager', 'logs', 'wrt'],
    header: "if(typeof webinos === 'undefined'){\n",
    footer: "}",

    // targets
    concat: {
      options: {
        banner: '<%= header %>',
        footer: '<%= footer %>'
      },
      dist: {
        src: [
          'webinos/core/wrt/lib/webinos.util.js',
          'node_modules/webinos-jsonrpc2/lib/registry.js',
          'node_modules/webinos-jsonrpc2/lib/rpc.js',
          'webinos/core/manager/messaging/lib/messagehandler.js',
          'webinos/core/wrt/lib/webinos.session.js',
          'webinos/core/wrt/lib/webinos.servicedisco.js',
          'webinos/core/wrt/lib/webinos.js',
          'webinos/core/api/file/lib/virtual-path.js',
          'webinos/core/wrt/lib/webinos.file.js',
          'webinos/core/wrt/lib/webinos.webnotification.js',
          'webinos/core/wrt/lib/webinos.zonenotification.js',
          'webinos/core/wrt/lib/webinos.actuator.js',
          'webinos/core/wrt/lib/webinos.tv.js',
          'webinos/core/wrt/lib/webinos.oauth.js',
          'webinos/core/wrt/lib/webinos.get42.js',
          'webinos/core/wrt/lib/webinos.geolocation.js',
          'webinos/core/wrt/lib/webinos.sensors.js',
          'webinos/core/wrt/lib/webinos.events.js',
          'webinos/core/wrt/lib/webinos.app2app.js',
          'webinos/core/wrt/lib/webinos.appstatesync.js',
          'webinos/core/wrt/lib/webinos.applauncher.js',
          'webinos/core/wrt/lib/webinos.vehicle.js',
          'webinos/core/wrt/lib/webinos.deviceorientation.js',
          'webinos/core/wrt/lib/webinos.context.js',
          'webinos/core/wrt/lib/webinos.authentication.js',
          'webinos/core/wrt/lib/webinos.contacts.js',
          'webinos/core/wrt/lib/webinos.devicestatus.js',
          'webinos/core/wrt/lib/webinos.discovery.js',
          'webinos/core/wrt/lib/webinos.payment.js',
          'webinos/core/wrt/lib/webinos.mediacontent.js',
          'webinos/core/wrt/lib/webinos.corePZinformation.js',
          'webinos/core/wrt/lib/webinos.nfc.js'
        ],
        dest: '<%= generated.normal %>'
      }
    },
    uglify: {
      options: {
        mangle: {
          toplevel: false
        }
      },
      dist: {
        src: '<%= generated.normal %>',
        dest: '<%= generated.min %>'
      }
    },
    jshint: {
      all: ['Gruntfile.js', 'webinos/**/*.js']
    },
    clean: ['<%= generated.normal %>', '<%= generated.min %>']
  });

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');

  grunt.registerTask(
    'check-rpc',
    'Check if webinos-jsonrpc2 is in local node_modules, required for concat task',
    function() {
      var isInstalled = (fs.existsSync || path.existsSync)('./node_modules/webinos-jsonrpc2/');
      if (!isInstalled) {
        console.log();
        console.log('\nError: webinos-jsonrpc2 must be in local node_modules.\n');
        console.log();
        return false;
      }
    });

  grunt.registerTask('clean-certs', 'Cleans certificates from user dir', function() {
    var userDir = function () {
      var dirpath = path.join.apply(path, arguments);
      var homepath = process.env[os.platform() === 'win32' ? 'USERPROFILE' : 'HOME'];
      dirpath = path.resolve(homepath, '.grunt', dirpath);
      return grunt.file.exists(dirpath) ? dirpath : null;
    };

    var winPath = ['AppData', 'Roaming', 'webinos'];
    var unixPath = ['.webinos'];

    var webinosRelPath = os.platform() === 'win32' ? winPath : unixPath;
    var relPath = ['..'].concat(webinosRelPath);
    // the path to .webinos/ dir
    var webinosConfPath = userDir.apply(null, relPath);

    // get subdirs from .webinos/
    var webinosConfSubdirs = fs.readdirSync(webinosConfPath);
    // exclude certain subdirs that are not to be deleted
    var paths = grunt.config.get('excludepaths');
    webinosConfSubdirs = webinosConfSubdirs.filter(function(subdir) {
      for (var i=0; i < paths.length; i++) {
        if (subdir === paths[i]) return false;
      }
      return true;
    });

    // build full path for the subdirs
    webinosConfSubdirs = webinosConfSubdirs.map(function(p) {
      return userDir.apply(null, relPath.concat([p]));
    });
    webinosConfSubdirs = webinosConfSubdirs.filter(function(p) {
      return p ? true : false;
    });
    if (!webinosConfSubdirs.length) {
      grunt.log.writeln('There are no certificates to remove.');
      return;
    }

    webinosConfSubdirs.forEach(function(p) {
      grunt.log.write('Deleting ' + p + ' ...');
      var r = grunt.file.delete(p, {force: true});
      if (r) {
        grunt.log.ok();
      } else {
        grunt.log.error();
      }
    });
  });

  grunt.registerTask('default', ['check-rpc', 'concat']);

  grunt.registerTask('minify', ['default', 'uglify']);
};