// Copyright (C) 2011 Colin Walters <walters@verbum.org>
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

const Resolve = new Lang.Class({
    Name: "Resolve",

    _init: function() {
    },

    execute: function(argv) {
	let cancellable = null;
        let parser = new ArgParse.ArgumentParser("Expand git revisions in source to exact targets");
        parser.addArgument('--manifest', {help:"Path to manifest file"});
        parser.addArgument('--fetch', {action:'storeTrue',
					help:"Also perform a git fetch"});
        parser.addArgument('--fetch-keep-going', {action:'storeTrue',
						  help:"Don't exit on fetch failures"});
        parser.addArgument('components', {nargs:'*',
					  help:"List of component names to git fetch"});

        let args = parser.parse(argv);

	let componentsToFetch = {};
        let fetchAll = false;
        if (args.fetch) {
            if (args.components.length) {
	        args.components.forEach(function (name) {
	            componentsToFetch[name] = true;
	        });
            } else {
                fetchAll = true;
            }
        }

        if (args.components.length > 0 && !args.fetch) {
            throw new Error("Can't specify components without --fetch");
	}

	this.config = Config.get();
        args.manifest = args.manifest || this.config.getGlobal('manifest');
	this.workdir = Gio.File.new_for_path(this.config.getGlobal('workdir'));
        this._snapshot = JsonUtil.loadJson(Gio.File.new_for_path(args.manifest), cancellable);
	this._mirrordir = Gio.File.new_for_path(this.config.getGlobal('mirrordir'));
        this.prefix = this._snapshot['prefix'];

        let baseModule = BuildUtil.resolveComponent(this._snapshot, this._snapshot['base']);
        baseModule.ensureMirror(cancellable, {fetch: fetchAll || componentsToFetch[baseModule.name],
                                              fetchKeepGoing: args.fetch_keep_going});
        this._snapshot['base'] = baseModule.getMeta();

        let globalPatchesModule = BuildUtil.resolveComponent(this._snapshot, this._snapshot['patches']);
        globalPatchesModule.ensureMirror(cancellable, {fetch: fetchAll || componentsToFetch[globalPatchesModule.name],
                                                       fetchKeepGoing: args.fetch_keep_going});
        this._snapshot['patches'] = globalPatchesModule.getMeta();

	let components = this._snapshot['components'];
        let resolvedComponents = [];
	for (let i = 0; i < components.length; i++) {
            let module = BuildUtil.resolveComponent(this._snapshot, components[i]);
            module.ensureMirror(cancellable, {fetch: fetchAll || componentsToFetch[module.name],
                                              fetchKeepGoing: args.fetch_keep_going});

            resolvedComponents[i] = module.getMeta();
	}
        this._snapshot['components'] = resolvedComponents;

        let uniqueComponentNames = {};
        for (let i = 0; i < resolvedComponents.length; i++) {
	    let component = resolvedComponents[i];
            let name = component['name'];
            if (uniqueComponentNames[name]) {
                throw new Error("Duplicate component name " + name);
	    }
            uniqueComponentNames[name] = true;
	}

        // Prevent duplicate resolution of src keys
        delete this._snapshot['vcsconfig'];

	let snapshotdir = this.workdir.get_child('snapshots');
	this._src_db = new JsonDB.JsonDB(snapshotdir, this.prefix + '-src-snapshot');
        let [path, modified] = this._src_db.store(this._snapshot, cancellable);
        if (modified) {
            print("New source snapshot: " + path.get_path());
        } else {
            print("Source snapshot unchanged: " + path.get_path());
	}
    }
});

function main(argv) {
    let ecode = 1;
    var resolve = new Resolve();
    GLib.idle_add(GLib.PRIORITY_DEFAULT,
		  function() { try { resolve.execute(argv); ecode = 0; } finally { loop.quit(); }; return false; });
    loop.run();
    return ecode;
}
