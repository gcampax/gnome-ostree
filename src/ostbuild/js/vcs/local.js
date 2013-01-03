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
const Git = imports.vcs.git;

const LocalModule = new Lang.Class({
    Name: 'LocalModule',
    Extends: Git.GitModule,
    keytype: 'local',

    _resolveMirror: function() {
        // Use new_for_command_line to handle both paths and file:// URIs
        return Gio.File.new_for_command_line_arg(this._uri);
    },

    ensureMirror: function(cancellable, params) {
        // Nothing to do, we checkout directly from the source
    },

    checkout: function(checkoutdir, cancellable, params) {
        let ftype = checkoutdir.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable);
        // Kind of a hack, but...
        if (ftype == Gio.FileType.SYMBOLIC_LINK)
            GSystem.file_unlink(checkoutdir, cancellable);
        if (args.overwrite && ftype == Gio.FileType.DIRECTORY)
            GSystem.shutil_rm_rf(checkoutdir, cancellable);

	checkoutdir.make_symbolic_link(this.mirror.get_path(), cancellable);
    },

    clean: function(checkoutdir, cancellable) {
        print("note: ignoring --clean argument due to \"local:\" specification");
    }
});
