// Copyright (C) 2011,2012 Colin Walters <walters@verbum.org>
//               2013 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// This library is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 2 of the License, or (at your option) any later version.
//
// This library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public
// License along with this library; if not, write to the
// Free Software Foundation, Inc., 59 Temple Place - Suite 330,
// Boston, MA 02111-1307, USA.

const Params = imports.params;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GSystem = imports.gi.GSystem;
const Lang = imports.lang;

const Config = imports.config;
const ProcUtil = imports.procutil;
const BuildUtil = imports.buildutil;
const Vcs = imports.vcs;

const GitModule = new Lang.Class({
    Name: 'GitModule',
    Extends: Vcs.Module,
    keytype: 'git',

    _init: function(uri, name, component) {
        this.parent(uri, name, component);

        this._branch = this._component['branch'] || this._component['tag'] || 'master';
    },

    _resolveName: function(name) {
        name = this.parent(name);

	let i = name.lastIndexOf('.git');
        if (i != -1 && i == name.length - 4) {
            name = name.substr(0, name.length - 4);
	}

        return name;
    },

    _getLastfetchPath: function() {
        let branchSafename = this._branch.replace(/[\/.]/g, '_');
        return this.mirror.get_parent().get_child(this.mirror.get_basename() + '.lastfetch-' + branchSafename);
    },

    _listSubmodules: function(currentVcsVersion, cancellable) {
        let tmpCheckout = this._resolveMirror('_tmp-checkouts');
        GSystem.shutil_rm_rf(tmpCheckout, cancellable);
        GSystem.file_ensure_directory(tmpCheckout.get_parent(), true, cancellable);

        ProcUtil.runSync(['git', 'clone', '-q', '--no-checkout', this.mirror.get_path(), tmpCheckout.get_path()], cancellable);
        ProcUtil.runSync(['git', 'checkout', '-q', '-f', currentVcsVersion], cancellable,
		         {cwd: tmpCheckout});
        let submodules = []
        let lines = ProcUtil.runSyncGetOutputLines(['git', 'submodule', 'status'],
					           cancellable, {cwd: tmpCheckout}); 
        for (let i = 0; i < lines.length; i++) {
	    let line = lines[i];
            if (line == '') continue;
            line = line.substr(1);
            let [subChecksum, subName, rest] = line.split(' ');
            let subUrl = ProcUtil.runSyncGetOutputUTF8(['git', 'config', '-f', '.gitmodules',
						        Format.vprintf('submodule.%s.url', [subName])], cancellable,
						       {cwd: tmpCheckout});
            submodules.push([subChecksum, subName, subUrl]);
        }
        GSystem.shutil_rm_rf(tmpCheckout, cancellable);
        return submodules;
    },

    ensureMirror: function(cancellable, params) {
        params = Params.parse(params, {fetch: false,
				       fetchKeepGoing: false});
        let tmpMirror = this.mirror.get_parent().get_child(this.mirror.get_basename() + '.tmp');
        let didUpdate = false;
        let lastFetchPath = this._getLastfetchPath();
        let lastFetchContents = null;
        if (lastFetchPath.query_exists(cancellable)) {
	    lastFetchContents = GSystem.file_load_contents_utf8(lastFetchPath, cancellable).replace(/[ \n]/g, '');
        }
        GSystem.shutil_rm_rf(tmpMirror, cancellable);

        if (!this.mirror.query_exists(cancellable)) {
            ProcUtil.runSync(['git', 'clone', '--mirror', this._uri, tmpMirror.get_path()], cancellable);
            ProcUtil.runSync(['git', 'config', 'gc.auto', '0'], cancellable, {cwd: tmpMirror});
            GSystem.file_rename(tmpMirror, this.mirror, cancellable);
        } else if (params.fetch) {
            print("Running git fetch for " + this.name);
	    try {
                ProcUtil.runSync(['git', 'fetch'], cancellable, {cwd: this.mirror});
	    } catch (e) {
	        if (!params.fetchKeepGoing)
		    throw e;
	    }
        }

        let currentVcsVersion = ProcUtil.runSyncGetOutputUTF8(['git', 'rev-parse', this._branch], cancellable,
							      {cwd: this.mirror}).replace(/[ \n]/g, '');

        let changed = currentVcsVersion != lastFetchContents;
        if (changed) {
            print(Format.vprintf("last fetch %s differs from branch %s", [lastFetchContents, currentVcsVersion]));
	    this._listSubmodules(currentVcsVersion, cancellable).forEach(function (elt) {
	        let [subChecksum, subName, subUrl] = elt;
	        print("Processing submodule " + subName + " at " + subChecksum + " from " + subUrl);
                let subComponent = {
                    name: subName,
                    src: 'git:' + subUrl,
                    revision: subChecksum
                };
                let m = new GitModule(subUrl, subName, subComponent);
                m.ensureMirror(cancellable, {fetch:params.fetch});
            });
        }

        if (changed) {
	    lastFetchPath.replace_contents(currentVcsVersion, null, false, 0, cancellable);
        }
    },

    describeVersion: function() {
        let args = ['git', 'describe', '--long', '--abbrev=42', '--always', this._branch];
        return ProcUtil.runSyncGetOutputUTF8(args, null, {cwd:this.mirror}).replace(/[ \n]/g, '');
    },

    _fixupSubmoduleReferences: function(cwd, cancellable) {
        let lines = ProcUtil.runSyncGetOutputLines(['git', 'submodule', 'status'],
					           cancellable, {cwd: cwd}); 
        let haveSubmodules = false;
        for (let i = 0; i < lines.length; i++) {
	    let line = lines[i];
            if (line == '') continue;
            haveSubmodules = true;
            line = line.substr(1);
            let [subChecksum, subName, rest] = line.split(' ');
	    let configKey = Format.vprintf('submodule.%s.url', [subName]);
            let subUrl = ProcUtil.runSyncGetOutputUTF8(['git', 'config', '-f', '.gitmodules', configKey],
						       cancellable, {cwd: cwd});
            let subComponent = {
                name: subName,
                src: 'git:' + subUrl,
                revision: subChecksum
            };
            let subModule = new GitModule(subUrl, subName, subComponent);
	    ProcUtil.runSync(['git', 'config', configKey, subModule.mirror.get_path()],
			     cancellable, {cwd:cwd});
        }
        return haveSubmodules;
    },

    checkout: function(dest, cancellable, params) {
        params = Params.parse(params, {overwrite: true,
				       quiet: false});
        let checkoutdirParent = dest.get_parent();
        GSystem.file_ensure_directory(checkoutdirParent, true, cancellable);
        let tmpDest = checkoutdirParent.get_child(dest.get_basename() + '.tmp');
        GSystem.shutil_rm_rf(tmpDest, cancellable);
        let ftype = dest.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable);
        if (ftype == Gio.FileType.SYMBOLIC_LINK) {
            GSystem.file_unlink(dest, cancellable);
        } else if (ftype == Gio.FileType.DIRECTORY) {
            if (params.overwrite) {
	        GSystem.shutil_rm_rf(dest, cancellable);
            } else {
                tmpDest = dest;
	    }
        }
        ftype = tmpDest.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable);
        if (ftype != Gio.FileType.DIRECTORY) {
            ProcUtil.runSync(['git', 'clone', '-q', '--origin', 'localmirror',
			      '--no-checkout', this.mirror.get_path(), tmpDest.get_path()], cancellable);
            ProcUtil.runSync(['git', 'remote', 'add', 'upstream', this._uri], cancellable, {cwd: tmpDest});
        } else {
            ProcUtil.runSync(['git', 'fetch', 'localmirror'], cancellable, {cwd: tmpDest});
        }
        ProcUtil.runSync(['git', 'checkout', '-q', this.revision], cancellable, {cwd: tmpDest});
        ProcUtil.runSync(['git', 'submodule', 'init'], cancellable, {cwd: tmpDest});
        let haveSubmodules = this._fixupSubmoduleReferences(tmpDest, cancellable);
        if (haveSubmodules) {
            ProcUtil.runSync(['git', 'submodule', 'update'], cancellable, {cwd: tmpDest});
        }
        if (!tmpDest.equal(dest)) {
            GSystem.file_rename(tmpDest, dest, cancellable);
        }
    },

    applyOnePatch: function(checkoutdir, patch, cancellable) {
        ProcUtil.runSync(['git', 'am', '--ignore-date', '-3', patch.get_path()], cancellable,
			 {cwd:checkoutdir});
    },

    clean: function(checkoutdir, cancellable) {
        ProcUtil.runSync(['git', 'clean', '-d', '-f', '-x'], cancellable,
		         {cwd: checkoutdir});
    },

    shortlog: function(checkoutdir, revisions, cancellable) {
        let args = ['git', 'log', '--format=short'];
        args.push(revisions.previous + '...' + revisions.current);
        let env = GLib.get_environ();
        env.push('GIT_PAGER=cat');
	ProcUtil.runSync(args, cancellable, {cwd: checkoutdir,
					     env: env});
    }
});
