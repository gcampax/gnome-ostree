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

const Module = new Lang.Class({
    Name: 'Module',
    Abstract: true,

    _init: function(uri, name, component) {
        this.config = Config.get();

        component = component || {};
        this._component = component;
        this._uri = uri;

        this.name = this._resolveName(name);
        this.name = this.name.replace(/\//g, '-');

        this.revision = component['revision'];

        this._mirrordir = Gio.File.new_for_path(this.config.getGlobal('mirrordir'));
        this.mirror = this._resolveMirror();
    },

    getMeta: function() {
        let result = {};
        Lang.copyProperties(this._component, result);

        result['src'] = this.keytype + ':' + this._uri;
        result['name'] = this.name;
        result['revision'] = this.revision || this.describeVersion();

        return result;
    },

    _resolveName: function(name) {
        let src, idx;
        if (name == undefined) {
            src = this._uri;
            idx = src.lastIndexOf('/');
            name = src.substr(idx+1);
	}

        return name;
    },

    _resolveMirror: function(prefix) {
        let colon = this._uri.indexOf('://');
        let scheme, rest;
        if (colon >= 0) {
            scheme = this._uri.substr(0, colon);
            rest = this._uri.substr(colon+3);
        } else {
            scheme = 'file';
            if (GLib.path_is_absolute(this._uri))
                rest = this._uri.substr(1);
            else
                rest = this._uri;
        }
        prefix = prefix ? prefix + '/' : '';
        return this._mirrordir.resolve_relative_path(prefix + this.keytype + '/' +
					             scheme + '/' + rest);
    },

    checkoutPatches: function(patchModule, cancellable, params) {
        if (params && params.patchesPath)
            return params.patchesPath;

	let workdir = Gio.File.new_for_path(this.config.getGlobal('workdir'));
        let patchdir = workdir.get_child('patches');
        patchModule.checkout(patchdir, cancellable, {overwrite: true, quiet: true});
        return patchdir;
    },

    applyPatches: function(checkoutdir, patchModule, cancellable, params) {
        let patchdir = this.checkoutPatches(patchModule, cancellable, params);

        let patches = BuildUtil.getPatchPathsForComponent(patchdir, this._component);
        for (let i = 0; i < patches.length; i++)
            this.applyOnePatch(checkoutdir, patches[i], cancellable);
    },

    ensureMirror: function(cancellable, params) {
        throw new Error('Not implemented');
    },

    describeVersion: function() {
        throw new Error('Not implemented');
    },

    checkout: function(checkoutdir, cancellable, params) {
        throw new Error('Not implemented');
    },

    applyOnePatch: function(checkoutdir, patch, cancellable) {
        throw new Error('Not implemented');
    },

    clean: function(checkoutdir, cancellable) {
        throw new Error('Not implemented');
    },

    shortlog: function(checkoutdir, revisions, cancellable) {
        throw new Error('Not implemented');
    }
});

