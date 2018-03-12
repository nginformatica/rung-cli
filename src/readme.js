import fs from 'fs';
import path from 'path';
import { all, promisify } from 'bluebird';
import { compile } from 'handlebars';
import {
    keys,
    merge,
    replace,
    values,
    zipWith
} from 'ramda';
import { version as rungCliVersion } from '../package';
import { getProperties } from './vm';
import { readFile, compileSources } from './run';
import { getTypeName } from './types';
import { compileES6 } from './compiler';
import { emitSuccess } from './input';

const createFile = promisify(fs.writeFile);

/**
 * Returns the source Handlebars template as string
 *
 * @return {Promise}
 */
function getHandlebarsTemplate() {
    return readFile(path.join(__dirname, '../templates/readme.hb'), 'utf-8')
        .then(compile);
}

/**
 * Converts an object to an array containing a list of { name, version }
 *
 * @param {Object} dependencies
 * @return {Array}
 */
function dependenciesToArray(dependencies) {
    return zipWith((name, version) => ({ name, version }),
        keys(dependencies),
        values(dependencies));
}

/**
 * Converts an object to an array containing a list of { name, type, description }
 *
 * @param {Object} parameters
 * @return {Array}
 */
function parametersToArray(parameters) {
    return zipWith(
        (name, { type, description }) => ({
            name,
            type: getTypeName(type),
            description }),
        keys(parameters),
        values(parameters));
}

/**
 * Generates a full README in Markdown with documentation about input parameters
 * and the business rules of the app
 *
 * @return {Promise}
 */
export default function readme() {
    return readFile('package.json', 'utf-8')
        .then(JSON.parse)
        .then(({ name, version, author, dependencies }) =>
            all([{
                rungCliVersion,
                name,
                version,
                author,
                escapedName: replace(/-/g, '--', name),
                dependencies: dependenciesToArray(dependencies) },
            compileSources()
                .spread((source, modules) =>
                    getProperties({ name: 'pre-compile', source: compileES6(source) }, {}, modules))]))
        .spread((partialContext, result) => merge(partialContext, {
            parameters: parametersToArray(result.params),
            description: result.description,
            title: result.title
        }))
        .then(context => all([context, getHandlebarsTemplate()]))
        .spread((context, generateReadme) => generateReadme(context))
        .then(createFile('README.md', _))
        .tap(~emitSuccess('generated README.md'));
}
