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

const TarballModule = new Lang.Class({
    Name: 'TarballModule',
    Extends: Vcs.Module,
    keytype: 'tarball',

    _init: function(uri, name, component) {
        this.parent(uri, name, component);

        // Let's use the GDummyFile power!
        let tarRemoteFile = Gio.File.new_for_uri(uri);
        this._tarFile = this.mirror.get_parent().get_child(tarRemoteFile.get_basename());
    },

    _resolveName: function(name) {
        // If name was not provided in the manifest file, derive from the tar name
        // by removing the version component

        if (name == undefined) {
            name = this.parent(name);

            let idx = name.lastIndexOf('-');
            if (idx >= 0)
                name = name.substr(0, idx);
        }

        return name;
    },

    _resolveMirror: function(prefix) {
        let i = this._uri.lastIndexOf('.tar');
        if (i < 0)
            throw new Error('Invalid URI for tarball module: ' + uri);

        let extension = this._uri.substr(i);

        if (extension != '.tar' &&
            extension != '.tar.gz' &&
            extension != '.tar.bz2' &&
            extension != '.tar.xz')
            throw new Error('Invalid URI for tarball module: ' + uri);

        let mirrorUri = this._uri.substr(0, i);

        let colon = mirrorUri.indexOf('://');
        let scheme, rest;
        if (colon >= 0) {
            scheme = mirrorUri.substr(0, colon);
            rest = mirrorUri.substr(colon+3);
        }

        // These are the only schemes wget understands (not even file!)
        if (scheme != 'http' &&
            scheme != 'https' &&
            scheme != 'ftp')
            throw new Error('Unsupported URI for tarball module: ' + uri);

        prefix = prefix ? prefix + '/' : '';
        return this._mirrordir.resolve_relative_path(prefix + this.keytype + '/' +
					             scheme + '/' + rest);
    },

    ensureMirror: function(cancellable, params) {
        // Different versions of the same tarball module have different
        // mirror directories, so the simple existance of the mirror dir
        // is enough to ensure that the version is correct

        if (this.mirror.query_exists(cancellable))
            return;

        GSystem.file_ensure_directory(this.mirror.get_parent(), true, cancellable);
        GSystem.file_ensure_directory(this._tarFile.get_parent(), true, cancellable);
        ProcUtil.runSync(['wget', this._uri, '-O', this._tarFile.get_path()], cancellable);
        ProcUtil.runSync(['tar', '-xf', this._tarFile.get_path(), '-C', this.mirror.get_parent().get_path()], cancellable);
    },

    describeVersion: function() {
	let contentsBytes = GSystem.file_map_readonly(this._tarFile, null);
	return GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256,
					       contentsBytes);
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
                print('note: cannot checkout tarball over existing directory without --overwrite');
                return;
	    }
        }

        ProcUtil.runSync(['cp', '-aT', '--reflink=auto', this.mirror.get_path(), tmpDest.get_path()], cancellable);
        GSystem.file_rename(tmpDest, dest, cancellable);
    },

    applyOnePatch: function(checkoutdir, patch, cancellable) {
        ProcUtil.runSync(['patch', '-i', patch.get_path(), '-p1'], cancellable,
                         {cwd: checkoutdir});
    },

    clean: function(checkoutdir, cancellable) {
        print('note: ignoring clean for tarball module ' + this.name);
    },

    shortlog: function(checkoutdir, revisions, cancellable) {
        print('note: cannot give VCS log for tarball modules');
    },
});
