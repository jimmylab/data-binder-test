const DataBinder = (() => {
	let NEW_DEP = null;
	const PATTERN_BIND_CLASS = /[\"\']?([a-zA-Z\$_][a-zA-Z\d_-]*)[\"\']?\s*\:\s*[\"\']?([a-zA-Z\$_][a-zA-Z\d_-]*)[\"\']?/g;

	// Util functions
	function parseBindClass(params) {
		let list = new Map()
		params.replace(PATTERN_BIND_CLASS, function (match, className, dataKey) {
			// console.log(className, dataKey);
			list.set(className, dataKey)
			return '';
		});
		return list;
	}
	function parseVal(elem, type) {
		type = type || elem.dataset.type;
		if (type === 'number') {
			return parseFloat(elem.value) || 0
		} else if (type === 'boolean') {
			if (elem.value === 'true') {
				return true
			} else if (elem.value === 'false') {
				return false
			} else {
				console.warn(`${elem.value} is not a boolean`);
				return false;
			}
		}
		return elem.value;
	};

	class Dep {
		constructor(binderData) {
			this.binderData = binderData;
			this.deps = [];
		}
		add() {
			if (Dep.NEW_WATCHER) {
				this.deps.push(Dep.NEW_WATCHER)
			}
		}
		notifyAll() {
			this.deps.forEach(watcher => {
				watcher.applyData(this.binderData);
			})
		}
	}
	Dep.NEW_WATCHER = null;

	class Watcher {
		constructor(target, bindClass = null, isComputed = false) {
			if (isComputed) {
				this.needUpdate = true;
			} else if (!(target instanceof HTMLElement)) {
				console.warn('Warning: Element below is not a valid DOM element:')
				console.warn(target);
			}
			Object.assign( this, { target, bindClass, isComputed } );
		}

		applyData(data) {
			let { target } = this;
			if (this.isComputed) {
				this.needUpdate = true;
				data[this.target] = 'whatever';
				return;
			}
			if (target.matches('[data-bind-class]')) {
				let { bindClass } = this;
				for (let [className, keyName] of bindClass) {
					target.classList.toggle(className, data[keyName])
				}
			}
			if (target.matches('[data-disabled]')) {
				let keyName = [target.dataset.disabled];
				target.disabled = data[keyName];
			}

			if (!target.matches('[data-model]')) return;
			let val = data[target.dataset.model];
			if (target.matches('input[type=checkbox]')) {
				let subkey = target.hasAttribute('value') ? parseVal(target) : null;
				if (val instanceof Set) {
					target.checked = val.has(subkey);
				} else {
					target.checked = val;
				}
			} else if (target.matches('input[type=radio]')) {
				target.checked = (target.value === String(val));
			} else if (target.matches('select')) {
				if (target.multiple && (val instanceof Set)) {
					target.querySelectorAll('option').forEach(optionEl => {
						optionEl.selected = val.has(optionEl.value);
					})
				} else {
					let selection = target.querySelector(`option[value="${val}"]`);
					if (selection){
						selection.selected = val;
					}
				}
			} else {
				target.value = val;
			}
		}
	}

	// TODO: add dataChange event
	// TODO: for-loop with <template> element (templeteElem.content to access 'document')
	// TODO: for-loop two-way binding (remember the template by data-template)
	// TODO: for-loop full syntax
	// TODO: Expression inside HTML
	class DataBinder {
		/**
		 *
		 * @param {Object} param
		 * @param {Element | String} param.el
		 * @param {Object} param.data
		 */
		constructor({el, data = {}, computed = {}, watch = {}, onDataChange = function(){}}) {
			if ('string' === typeof el) {
				this.elem = el = document.querySelector(el);
			} else if (el instanceof Element) {
				this.elem = el;
			} else {
				throw Error('Element is neither a selector or a DOM element');
			}

			this.data = {};

			// Serializer for JSON.stringify
			Object.defineProperty(this.data, 'toJSON', {
				enumerable: false,
				configurable: false,
				writable: true,    // customize enabled
				value: jsonKey => {
					let o = {};
					Object.keys(this.data).forEach(key => {
						let val = this.data[key];
						o[key] = (val instanceof Set) ? [...val] : val
					});
					return o;
				},
			})

			// Data triggers
			Object.keys(data).forEach(key => {
				let val = data[key];
				let dep = new Dep(this.data);
				Object.defineProperty(this.data, key, {
					enumerable: true,
					configurable: false,
					get: () => {
						dep.add();
						return val;
					},
					set: newVal => {
						val = newVal;
						dep.notifyAll();
						setTimeout(onDataChange.bind(this.data, key, val), 1)
					}
				})
			})

			// Add computed attributes
			Object.keys(computed).forEach(key => {
				if (data.hasOwnProperty(key)) {
					console.warn(`Data model "${key}" already exists`);
					return;
				}
				let compute = computed[key];
				compute = compute.bind(this.data);
				let dep = new Dep(this.data);
				let watcher = null;
				let val;
				Object.defineProperty(this.data, key, {
					enumerable: false,
					configurable: false,
					get: () => {
						dep.add();
						if (!watcher) {
							watcher = new Watcher(key, null, true);
							Dep.NEW_WATCHER = watcher;
							val = compute(this.data);
							Dep.NEW_WATCHER = null;
							watcher.needUpdate = false;
							dep.notifyAll();
						} else if (watcher.needUpdate) {
							val = compute(this.data);
							watcher.needUpdate = false;
							dep.notifyAll();
							setTimeout(onDataChange.bind(this.data, key, val), 1)
						}
						return val;
					},
					set: (whatever) => {
						dep.notifyAll();
					}
				});
			})

			// Walk over elements with for-loop
			el.querySelectorAll('[data-for]').forEach(elem => {
				let loopPara = elem.dataset.for;
				loopPara = loopPara.match(/^\s*([a-zA-Z\$_][a-zA-Z\d_]*)\s+in\s+([a-zA-Z\$_][a-zA-Z\d_]*)\s*$/)
				if (loopPara === null) {
					console.error(`"${loopPara}" a valid loop syntax`);
					return;
				}
				let [, varItem, dataKey] = loopPara;
				if (!this.data.hasOwnProperty(dataKey)) {
					console.warn(`[Warning] The data model "${dataKey}" does not exist`)
					return;
				}
				let val = this.data[dataKey];
				let replacedHTML = [];
				for (let k in val) {
					let html = elem.outerHTML.replace(/\{\{.+?\}\}/g, (expr) => {
						expr = expr.replace(/^\{\{|\}\}$/g, '');
						let item = val[k]
						try {
							let func = new Function(varItem, dataKey, `return ( ${expr} )`)
							return func(item, val)
						} catch (err) {
							console.error(err)
							return '';
						}
					})
					replacedHTML.push(html);
				}
				elem.insertAdjacentHTML('afterend', replacedHTML.join('\n'));
				elem.parentNode.removeChild(elem);
			});

			// Walk over elements which has a model
			el.querySelectorAll('[data-model],[data-bind-class],[data-disabled]').forEach(target => {
				let dataKeys = new Set();
				let bindClass = null;
				if (target.dataset.model) {
					dataKeys.add(target.dataset.model)
				}
				if (target.dataset.bindClass) {
					bindClass = parseBindClass(target.dataset.bindClass);
					dataKeys = new Set([...dataKeys, ...bindClass.values()])
				}
				if (target.dataset.disabled) {
					dataKeys.add(target.dataset.disabled)
				}

				let watcher = new Watcher(target, bindClass);
				Dep.NEW_WATCHER = watcher;
				dataKeys.forEach(key => {
					if (!this.data.hasOwnProperty(key)) {
						console.warn(`[Warning] The data model "${key}" does not exist`)
						return;
					}
					// pass dep to getter
					let val = this.data[key]
				});
				Dep.NEW_WATCHER = null;

				watcher.applyData(this.data);
			});

			// Handle input element change
			let onChange = ev => {
				let {target} = ev;
				if (!target.dataset.model) return;
				if (!target.matches('input[type=checkbox], input[type=radio], select')) return;
				let key = target.dataset.model;
				let val = this.data[key];
				if (target.matches('input[type=checkbox]')){
					if (val instanceof Set) {
						let newVal = parseVal(target);
						target.checked ? val.add(newVal) : val.delete(newVal)
						this.data[key] = val;
					} else {
						this.data[key] = target.checked;
					}
				} else if (target.matches('input[type=radio]')) {
					if (typeof val === 'boolean'){
						this.data[key] = parseVal(target, 'boolean')
					} else {
						this.data[key] = parseVal(target);
					}
				} else if (target.tagName === 'SELECT') {
					if (target.multiple && (val instanceof Set)) {
						let valType = target.dataset.type || 'string';
						target.querySelectorAll('option').forEach(optionEl => {
							optionEl.selected ?
								val.add(parseVal(optionEl, valType)) :
								val.delete(parseVal(optionEl, valType))
						});
						this.data[key] = val;
					} else {
						this.data[key] = target.value;
					}
				}
			}

			let onInput = ev => {
				let {target} = ev;
				if (!target.dataset.model) return;
				if (target.matches('input[type=checkbox], input[type=radio], select')) return;
				// if (target.matches('input[type=number]') && target.value === '') {
				// 	target.value = 0;
				// }
				let key = target.dataset.model;
				this.data[key] = target.value;
			}

			el.addEventListener('change', onChange);
			el.addEventListener('input', onInput);
		}

		getData() {
			let o = {};
			Object.entries(this.data).forEach(([key, val]) => {
				if (val instanceof Set) {
					val = new Set(val)
				}
				o[key] = val;
			})
			return o;
		}

		setData(o) {
			if (!o) return;
			Object.entries(o).forEach(([key, val]) => {
				if (val instanceof Set) {
					val = new Set(val)
				}
				this.data[key] = val;
			})
		}
	}
	return DataBinder;
}) ();