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
const format = imports.format;
const Lang = imports.lang;

const GSystem = imports.gi.GSystem;

const VERSION_RE = /(\d+)\.(\d+)/;

const TaskDir = new Lang.Class({
    Name: 'TaskDir',

    _init: function(path) {
	this.path = path;
    },

    get: function(name) {
	let child = this.path.get_child(name);
	GSystem.file_ensure_directory(child, true, null);

	return new TaskSet(child);
    }
});

const TaskHistoryEntry = new Lang.Class({
    Name: 'TaskHistoryEntry',

    _init: function(path, state) {
	this.path = path;
	let match = VERSION_RE.exec(path.get_basename());
	this.major = parseInt(match[1]);
	this.minor = parseInt(match[2]);
	this.timestamp = null;
	this.logfile_path = null;
	this.start_timestamp = null;

	if (state == undefined) {
	    let statusPath = this.path.get_child('status');
	    if (statusPath.query_exists(null)) {
		let ioStream = statusPath.read(null);
		let info = ioStream.query_info("unix::mtime", null);
		let contents = ioStream.read_bytes(8192, null);
		this.state = contents;
		ioStream.close(null);
		this.timestamp = info.get_attribute_uint64("time::modified");
	    } else {
		this.state = 'interrupted';
	    }
	} else {
	    this.state = state;
	    this.start_timestamp = new Date().getTime() / 1000;
	}
    },

    finish: function(success) {
	let statusPath = this.path.get_child('status');
	this.state = success ? 'success' : 'failed';
	statusPath.replace_contents(this.state, null, false, 0, null);
	this.timestamp = new Date().getTime() / 1000;
    },

    compareTo: function(a, b) {
	function cmp(a, b) {
	    if (a == b) return 0;
	    else if (a < b) return -1;
	    else return 1;
	}
	let c = cmp(a.major, b.major);
	if (c != 0) return c;
	return cmp(a.minor, b.minor);
    }
});

const TaskSet = new Lang.Class({
    Name: 'TaskSet',

    _init: function(path, prefix) {
	this.path = path;

	this._history = [];
	this._running = false;
	this._running_version = null;
	this._maxVersions = 10;
	
	this._load();
    },

    _cleanOldEntries: function() {
	while (this._history.length > this._maxVersions) {
	    let task = this._history.shift();
	    GSystem.shutil_rm_rf(task.path, null);
	}
    },

    _load: function() {
	var e = this.path.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
	let info;
	let history = [];
	while ((info = e.next_file(null)) != null) {
	    let name = info.get_name();
	    let childPath = this.path.get_child(name);
	    let match = VERSION_RE.exec(name);
	    if (!match)
		continue;
	    history.push(new TaskHistoryEntry(childPath))
	}
	history.sort(TaskHistoryEntry.prototype.compareTo);
	this._history = history;
	this._cleanOldEntries();
    },

    start: function() {
	if (this._running) throw new Error();
	this._running = true;
	let yearver = new Date().getFullYear();
	let lastversion = -1;
	if (this._history.length > 0) {
	    let last = this._history[this._history.length-1];
	    if (last.major == yearver)
		lastversion = last.minor;
	    else
		lastversion = -1;
	}
	let historyPath = this.path.get_child(format.vprintf('%d.%d', [yearver, lastversion + 1]));
	GSystem.file_ensure_directory(historyPath, true, null);
	let entry = new TaskHistoryEntry(historyPath, 'running');
	this._history.push(entry);
	entry.logfile_path = historyPath.get_child('log');
	return entry;
    },

    finish: function(success) {
	if (!this._running) throw new Error();
	let last = this._history[this._history.length-1];
	last.finish(success);
	this._running = false;
	this._cleanOldEntries();
    },

    getHistory: function() {
	return this._history;
    }
});
