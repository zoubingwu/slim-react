import debug from 'debug';

const d = debug('react');

const TEXT_ELEMENT = 'TEXT_ELEMENT';

interface ReactElementProps {
  [key: string]: any;
  children?: ReactElement[];
}

interface ReactElement {
  type: string;
  props: ReactElementProps;
}

interface ReactFiber {
  type?: string | Function;
  dom: HTMLElement | Text;
  props: ReactElementProps;
  alternate?: ReactFiber;
  child?: ReactFiber;
  sibling?: ReactFiber;
  parent?: ReactFiber;
  effectTag?: 'UPDATE' | 'PLACEMENT' | 'DELETION';
  hooks?: any[];
}

let wipRoot: ReactFiber | null = null;
let currentRoot: ReactFiber | null = null;
let nextUnitOfWork: ReactFiber | null = null;
let deletions: ReactFiber[] = [];

export function render(element: ReactElement, container: HTMLElement) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  }

  nextUnitOfWork = wipRoot;
}

function createElement(
  type: string, 
  config: ReactElementProps, 
  ...children: ReactElement[]
): ReactElement {
  let props: ReactElementProps = {};

  if (config !== null) {
    props = Object.assign({}, config);
  }

  props.children = children.map(i => {
    if (typeof i === "object") {
      return i;
    } else {
      return createTextElement(i);
    }
  });

  return {
    type,
    props
  };
}

function createTextElement(text: string) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: []
    }
  };
}

function isEvent(key: string) {
  return key.startsWith('on');
}

function isProperty(key: string) {
  return key !== 'children' && !isEvent(key);
}

function createDOMNode(fiber: ReactFiber): HTMLElement | Text {
  const node = fiber.type === TEXT_ELEMENT
    ? document.createTextNode("")
    : document.createElement(fiber.type as string);

  updateDOMNode(node, {}, fiber.props);

  return node;
}

function updateDOMNode(node: HTMLElement | Text, prevProps: ReactElementProps, nextProps: ReactElementProps) {
  const isNew = (prev:ReactElementProps, next: ReactElementProps) => (key: string) => prev[key] !== next[key];
  const isGone = (prev: ReactElementProps, next: ReactElementProps) => (key: string) => !(key in next);
  
  // remove old event listeners
  Object.keys(prevProps).filter(isEvent).filter(key => !(key in nextProps) || isNew(prevProps, nextProps)(key)).forEach(name => {
    const eventType = name.toLowerCase().substring(2);
    d('remove old event listener %o', eventType)
    node.removeEventListener(eventType, prevProps[name]);
  });

  // add new event listeners
  Object.keys(nextProps).filter(isEvent).filter(isNew(prevProps, nextProps)).forEach(name => {
    const eventType = name.toLowerCase().substring(2);
    d('add new event listener %o', eventType)
    node.addEventListener(eventType, nextProps[name]);
  });

  // remove attributes
  Object.keys(prevProps).filter(isProperty).filter(isGone(prevProps, nextProps)).forEach(name => {
    node[name] = '';
    d('remove old attributes %o', name)
  });

  // set or update attributes
  Object.keys(nextProps).filter(isProperty).filter(isNew(prevProps, nextProps)).forEach(name => {
    node[name] = nextProps[name];
    d('set attributes %o and value is %o', name, nextProps[name])
  });
}

function workLoop(deadline: IdleDeadline) {
  let shouldYield = false;

  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);  
    
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  window.requestIdleCallback(workLoop);
}

window.requestIdleCallback(workLoop);

let wipFiber: ReactFiber = null;
let hookIndex = null;

function useState<T>(initial: T) {
  const oldHook = wipFiber?.alternate?.hooks?.[hookIndex];
  
  type Action = (state: T) => T;

  const hook: {
    state: T;
    queue: Action[];
  } = {
    state: oldHook ? oldHook.state : initial,
    queue: []
  }

  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action: Action) => {
    hook.state = action(hook.state);
  });

  d('hook state is %o', hook.state);

  type SetState = (action: Action) => void;

  const setState: SetState = (action: Action) => {
    hook.queue.push(action);
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    }

    nextUnitOfWork = wipRoot;
    deletions = [];
  }

  wipFiber.hooks.push(hook);
  hookIndex++;

  return [hook.state, setState] as [T, SetState];
}

function updateFunctionComponent(fiber: ReactFiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [(fiber.type as Function)(fiber.props)];
  reconcileChildren(fiber, children);
}
​
function updateHostComponent(fiber: ReactFiber) {
  if (!fiber.dom) {
    fiber.dom = createDOMNode(fiber)
  }
  reconcileChildren(fiber, fiber.props.children)
}

function performUnitOfWork(fiber: ReactFiber): ReactFiber {
  d('performUnitOfWork', fiber);

  const isFunctionComponent = typeof fiber.type === 'function';

  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) {
    return fiber.child;
  }

  let nextFiber = fiber;

  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

function commitRoot() {
  d('commit root: %o', wipRoot)
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

function commitWork(fiber?: ReactFiber) {
  if (!fiber) {
    return;
  }
  d('commit work: %o', fiber);

  let parentFiber = fiber.parent;

  while (!parentFiber.dom) {
    parentFiber = parentFiber.parent;
  }

  const parentDom = parentFiber.dom;

  if (fiber.effectTag === 'PLACEMENT' && fiber.dom != null) {
    parentDom.appendChild(fiber.dom);
  } else if (fiber.effectTag === 'DELETION') {
    parentDom.removeChild(fiber.dom);
  } else if (fiber.effectTag === 'UPDATE' && fiber.dom != null) {
    updateDOMNode(
      fiber.dom, 
      fiber.alternate.props, 
      fiber.props
    )
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function reconcileChildren(wipFiber: ReactFiber, elements: ReactElement[]) {
  let index = 0;
  let oldFiber = wipFiber?.alternate?.child;

  let prevSibling: ReactFiber = null;

  while (
    index < elements.length ||
    oldFiber != null
  ) {
    const element = elements[index];
    let newFiber: ReactFiber = null;
    const isSameType = oldFiber && element && element.type === oldFiber.type;

    if (isSameType) {
      // update
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: 'UPDATE',
      }
    }

    if (element && !isSameType) {
      // add
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: 'PLACEMENT',
      }
    }

    if (oldFiber && !isSameType) {
      // delete
      oldFiber.effectTag = 'DELETION';
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if(element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;

    index++;
  }
}

const React = {
  createElement,
  render,
  useState,
}

const Title = () => <h1 onClick={() => {alert('hello')}}>hello</h1>

const App = ({ name }) =>(
  <div onClick={() => {alert(name)}}>
    <p>hello {name}</p>
    <a href="#asd">this is a link</a>
  </div>
);

const Counter = () => {
  const [state, setState] = useState(1);
  return (
    <h1 onClick={() => setState(c => c + 1)}>
      Count: {state}
    </h1>
  )
}

const container = document.getElementById("app");
render(<Counter />, container);
