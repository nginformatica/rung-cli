import fs from 'fs';
import vm from 'vm';
import path from 'path';
import Promise, { promisify, resolve } from 'bluebird';
import {
    __,
    contains,
    curry,
    either,
    has,
    isEmpty,
    map,
    merge,
    pipe,
    propOr,
    reject as rejectWhere,
    split,
    test
} from 'ramda';
import { compileHTML } from './compiler';
import { upsert, clear } from './db';

const readFile = promisify(fs.readFile);

/**
 * Creates a pure module that will be populated by dev script
 *
 * @author Marcelo Haskell Camargo
 * @param {String} id - The id of the application
 * @return {Object}
 */
const createModule = id => ({
    id,
    exports: {},
    parent: null,
    filename: `${id}.js`,
    loaded: false,
    children: [],
    paths: []
});

/**
 * Creates a pure module dataset that will be populated by dev script
 *
 * @author Marcelo Haskell Camargo
 * @return {Object}
 */
const createExports = () => ({});

/**
 * Gets the list of allowed packages
 *
 * @author Marcelo Haskell Camargo
 * @return {Promise}
 */
function getPackagesWhitelist() {
    return readFile(path.join(__dirname, 'packages.txt'), 'utf-8')
        .then(split('\n'))
        .then(rejectWhere(isEmpty));
}

/**
 * The Rung version of console. It exposes the name of the extension that is
 * logging it
 *
 * @author Marcelo Haskell Camargo
 * @param {String} name - The name of the extension
 * @return {Object}
 */
const __console = name => ({
    log(content) {
        console.log(`ext [${name}]: `, content);
    }
});

/**
 * The Rung version of require. It filters whitelisted packages
 *
 * @author Marcelo Haskell Camargo
 * @param {Array} whitelist
 * @param {String} module
 * @return {Function}
 */
export const __require = curry((whitelist, module) => {
    const toRegex = name => new RegExp(`^${name}(/.*)?$`);
    const moduleIs = contains(module);
    const moduleMatch = pipe(
        map(pipe(toRegex, test(__, module))),
        contains(true)
    );
    const isValidModule = either(moduleIs, moduleMatch);

    if (isValidModule(whitelist)) {
        return require(module);
    }

    throw new Error(`Disallowed dependency: ${module}`);
});

/**
 * Runs an extension on a virtualized environment and returns its result as
 * native JS data
 *
 * @author Marcelo Haskell Camargo
 * @param {String} name - The unique identifier to track the extension
 * @param {String} source - ES6 source to run
 * @param {Object} context - Object with global-scoped variables
 * @return {Promise}
 */
function runInSandbox(name, source, context = {}) {
    return getPackagesWhitelist()
        .then(packages => {
            const __module = createModule(name);
            const __exports = createExports();
            const v8Context = vm.createContext(merge({
                module: __module,
                exports: __exports,
                console: __console(name),
                require: __require(packages),
                render: compileHTML }, context));
            const script = new vm.Script(source, { filename: `${name}.js` });
            return resolve(script.runInNewContext(v8Context));
        });
}

/**
 * Tries to get the parameter types by running the script to get config.params
 *
 * @author Marcelo Haskell Camargo
 * @param {Object} extension
 * @return {Promise}
 */
export function getProperties(extension) {
    return runInSandbox(extension.name, extension.source)
        .then(propOr({}, 'config'));
}

/**
 * Records database if set to; otherwise, drop it
 *
 * @param {Object} result
 * @return {Promise}
 */
const updateDb = curry((name, result) => has('db', result) ? upsert(name, result.db) : clear(name));

/**
 * Runs an extension with a context (with parameters) and gets the alerts.
 * The result may be a string, a nullable value, an array...
 *
 * @author Marcelo Haskell Camargo
 * @param {Object} extension
 * @param {Object} context
 * @return {Promise}
 */
export function runAndGetAlerts(extension, context) {
    return runInSandbox(extension.name, extension.source)
        .then(app => {
            const runExtension = () => new Promise(resolve => {
                // Async vs sync extension
                if (app.extension.length > 1) {
                    app.extension(context, resolve);
                } else {
                    resolve(app.extension(context));
                }
            });

            return runExtension();
        })
        .tap(updateDb(extension.name));
}
