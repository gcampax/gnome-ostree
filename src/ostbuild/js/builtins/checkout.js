// Copyright (C) 2012,2013 Colin Walters <walters@verbum.org>
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

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Format = imports.format;

const GSystem = imports.gi.GSystem;

const Task = imports.task;
const JsonDB = imports.jsondb;
const ProcUtil = imports.procutil;
const JsonUtil = imports.jsonutil;
const Snapshot = imports.snapshot;
const Config = imports.config;
const BuildUtil = imports.buildutil;
const ArgParse = imports.argparse;

var loop = GLib.MainLoop.new(null, true);

const Checkout = new Lang.Class({
    Name: 'Checkout',

    _init: function() {
    },

    execute: function(argv) {
	let cancellable = null;
	let parser = new ArgParse.ArgumentParser('Check out specified modules');
	parser.addArgument('--overwrite', {action:'storeTrue'});
	parser.addArgument('--prefix');
	parser.addArgument('--patches-path');
	parser.addArgument('--metadata-path');
	parser.addArgument('--snapshot');
	parser.addArgument('--checkoutdir');
	parser.addArgument('--clean', {action: 'storeTrue'});
	parser.addArgument('component');

	let args = parser.parse(argv);
        
	this.config = Config.get();
	this.workdir = Gio.File.new_for_path(this.config.getGlobal('workdir'));
	this.mirrordir = Gio.File.new_for_path(this.config.getGlobal('mirrordir'));
	this.patchdir = this.workdir.get_child('patches');
	if (!this.mirrordir.query_exists(cancellable))
	    throw new Error("Need mirrordir: "+ this.mirrordir.get_path());
	this.prefix = args.prefix || this.config.getPrefix();
	this._snapshotDir = this.workdir.get_child('snapshots');

	this._srcDb = new JsonDB.JsonDB(this._snapshotDir, this.prefix + '-src-snapshot');
	[this._snapshot, this._snapshotPath] = Snapshot.load(this._srcDb, this.prefix, args.snapshot, cancellable);

        let componentName = args.component;

        let patchModule = BuildUtil.resolveComponent(this._snapshot, this._snapshot['patches']);

	let component;
        if (args.metadata_path != null) {
	    component = JsonUtil.loadJson(Gio.File.new_for_path(args.metadata_path), cancellable);
        } else {
            component = Snapshot.getExpanded(this._snapshot, componentName);
	}
        let module = BuildUtil.resolveComponent(this._snapshot, component);

        let checkoutdir;
        if (args.checkoutdir) {
            checkoutdir = Gio.File.new_for_path(args.checkoutdir);
        } else {
            checkoutdir = Gio.File.new_for_path(componentName);
	    GSystem.file_ensure_directory(checkoutdir.get_parent(), true, cancellable);
	}

        module.checkout(checkoutdir, cancellable, {overwrite: args.overwrite});
        if (args.clean)
            module.clean(checkoutdir, cancellable);
        /*
	let checkoutdir;
        if (isLocal) {
            if (args.checkoutdir != null) {
                checkoutdir = Gio.File.new_for_path(args.checkoutdir);
		let ftype = checkoutdir.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable);
                // Kind of a hack, but...
                if (ftype == Gio.FileType.SYMBOLIC_LINK)
                    GSystem.file_unlink(checkoutdir, cancellable);
                if (args.overwrite && ftype == Gio.FileType.DIRECTORY)
                    GSystem.shutil_rm_rf(checkoutdir, cancellable);

		checkoutdir.make_symbolic_link(uri, cancellable);
            } else {
                checkoutdir = Gio.File.new_for_path(uri);
	    }
        } else {

            Vcs.getVcsCheckout(this.mirrordir, keytype, uri, checkoutdir,
                               component['revision'], cancellable,
                               {overwrite: args.overwrite});
	}

        if (args.clean) {
            if (isLocal) {
                print("note: ignoring --clean argument due to \"local:\" specification");
            } else {
                Vcs.clean(keytype, checkoutdir, cancellable);
	    }
	}
        */

        let patchesPath = args.patches_path ? Gio.File.new_for_path(args.patches_path) : null;
        module.applyPatches(checkoutdir, patchModule, cancellable, { patchesPath: patchesPath });

        let metadataPath = checkoutdir.get_child('_ostbuild-meta.json');
	JsonUtil.writeJsonFileAtomic(metadataPath, component, cancellable);

        print("Checked out: " + checkoutdir.get_path());
    }
});

function main(argv) {
    let ecode = 1;
    var checkout = new Checkout();
    GLib.idle_add(GLib.PRIORITY_DEFAULT,
		  function() { try { checkout.execute(argv); ecode = 0; } finally { loop.quit(); }; return false; });
    loop.run();
    return ecode;
}
