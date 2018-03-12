import fs from 'fs';
import process from 'process';
import path from 'path';
import http from 'http';
import opn from 'opn';
import watch from 'node-watch';
import { listen } from 'socket.io';
import Promise, { promisify, props } from 'bluebird';
import {
    has,
    join,
    lensProp,
    map,
    mergeAll,
    over,
    replace,
    when
} from 'ramda';
import { Converter } from 'showdown';
import { executeWithParams, readFile } from './run';
import { emitError, emitInfo, emitSuccess } from './input';

const readDirectory = promisify(fs.readdir);

/**
 * Emits the Rung emoji to the live server ;)
 *
 * @return {Promise}
 */
function emitRungEmoji() {
    return [
        '',
        '   ___       _  _______',
        '  / _ \\__ __/ |/ / ___/',
        ' / , _/ // /    / (_ /',
        '/_/|_|\\_,_/_/|_/\\___/',
        ''
    ] | join('\n') | emitInfo;
}

/**
 * Returns an object with resource path and buffer
 *
 * @return {Promise}
 */
const getResources = () => {
    const resources = path.join(__dirname, '../resources/live');
    return readDirectory(resources)
        .map(filename => props({
            [`/${filename}`]: readFile(path.join(resources, filename))
        }))
        .then(mergeAll);
};

/**
 * Compiles the content of the cards to be compatible with HTML
 *
 * @param {Object} alerts
 * @return {Object[]}
 */
const compileMarkdown = alerts => {
    const converter = new Converter();
    return alerts
        | map(when(has('comment'),
            over(lensProp('comment'), replace(/^[ \t]+/gm, '') & converter.makeHtml)));
};

/**
 * Watches folder for file changes, hot recompiling everything and notifying
 * the clients
 *
 * @param {SocketIO} io
 * @param {Object} params
 * @return {Object}
 */
function watchChanges(io, params) {
    const folder = process.cwd();
    return watch(folder, { recursive: true }, () => {
        emitInfo('changes detected. Recompiling...');
        io.sockets.emit('load');
        const start = new Date().getTime();
        executeWithParams(params)
            .tap(alerts => {
                const ellapsed = new Date().getTime() - start;
                emitSuccess(`wow! recompiled and executed in ${ellapsed}ms!`);
                io.sockets.emit('update', compileMarkdown(alerts));
            })
            .catch(err => {
                emitError(`hot compilation error, baby: ${err.message}`);
                io.sockets.emit('failure', err.stack);
            });
    });
}

/**
 * Starts the stream server using sockets
 *
 * @param {Object} alerts
 * @param {Object} params
 * @param {Number} port
 * @param {Object} resources
 * @return {Promise}
 */
function startServer(alerts, params, port, resources) {
    const compiledAlerts = compileMarkdown(alerts);
    const app = http.createServer((req, res) =>
        res.end(resources[req.url] || resources['/index.html']));
    const io = listen(app);
    io.on('connection', socket => {
        emitInfo(`new session for ${socket.handshake.address}`);
        socket.emit('update', compiledAlerts);
        socket.on('disconnect', () => {
            emitInfo(`disconnected session ${socket.handshake.address}`);
        });
    });

    return new Promise(resolve => app.listen(port, emitRungEmoji & resolve))
        .then(~watchChanges(io, params));
}

/**
 * Generates a HTML file compiled from template showing the cards as they will
 * be rendered on Rung and opens it in the default browser
 *
 * @return {Promise}
 */
export default (alerts, params) => getResources()
    .tap(startServer(alerts, params, 5001, _))
    .tap(() => {
        try {
            opn('http://localhost:5001/');
        } catch (err) {
            // Skip
        }
    });
