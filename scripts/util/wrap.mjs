/* wrap.mjs - wrap a prototype method, optionally through libWrapper.
 *
 * libWrapper is not required. When it is active the wrapper is registered the
 * way every other module expects, so load order and CONFLICT reporting work.
 * Otherwise a plain wrapper is installed and the original is kept reachable
 * through the first argument.
 */

/**
 * Wrap `Class.prototype[name]`.
 *
 * @param {Function} Class        class holding the method
 * @param {string} name           method name
 * @param {Function} wrapper      called as wrapper(original, ...args) with `this` set to the instance
 * @param {object} [options]
 * @param {string} [options.moduleId]  libWrapper package id
 * @param {string} [options.namespace] dot path used to resolve the class for libWrapper
 * @returns {boolean}             true when a wrapper was installed
 */
export function wrapMethod(Class, name, wrapper, { moduleId, namespace } = {}) {
  const proto = Class?.prototype;
  if (!proto || typeof proto[name] !== "function") return false;

  const libWrapper = globalThis.libWrapper;
  if (libWrapper?.register && moduleId) {
    const classPath = namespace
      ? `${namespace}.prototype.${name}`
      : `${Class.name}.prototype.${name}`;
    try {
      const resolvable = globalThis.foundry?.utils?.getProperty?.(globalThis, classPath);
      if (resolvable) {
        libWrapper.register(moduleId, classPath, wrapper, "WRAPPER");
        return true;
      }
    } catch (err) {
      console.warn(`[knkr03-drags] libWrapper could not wrap ${classPath}; falling back`, err);
    }
  }

  const original = proto[name];
  proto[name] = function (...args) {
    return wrapper.call(this, original, ...args);
  };
  return true;
}
