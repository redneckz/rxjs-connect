import React from 'react';
import Enzyme, {mount} from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import {internals} from 'react-redux';
import {Observable} from 'rxjs/Observable';
import 'rxjs/add/observable/empty';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/ignoreElements';
import 'rxjs/add/operator/finally';
import {isFunction} from '../utils';
import {connect} from './connect';

Enzyme.configure({adapter: new Adapter()});

jest.mock('react-redux', () => {
    const {createElement} = require('react'); // eslint-disable-line global-require
    const INITIAL_STORE_STATE = {xyzzy: 'xyzzy'};
    let storeState = INITIAL_STORE_STATE;
    let lastAction;
    const dispatch = (action) => {
        lastAction = action;
        return action;
    };
    return {
        connect(stateToPropsMapper = () => ({})) {
            return WrappedComponent => props => (
                createElement(WrappedComponent, {
                    ...props,
                    ...stateToPropsMapper(storeState),
                    dispatch
                })
            );
        },
        internals: {
            INITIAL_STORE_STATE,
            reset() {
                storeState = INITIAL_STORE_STATE;
                lastAction = undefined;
            },
            get lastAction() {
                return lastAction;
            },
            get storeState() {
                return storeState;
            },
            set storeState(nextStoreState) {
                storeState = nextStoreState;
            }
        }
    };
});

describe('connect decorator', () => {
    function Foo() {
        return <div />;
    }

    beforeEach(() => {
        internals.reset();
    });

    it('should pass props to underlying/wrapped component', () => {
        const FooWrapper = connect()(Foo);
        const fooWrapper = mount(<FooWrapper bar={123} visible />);
        const foo = fooWrapper.find(Foo);
        expect(foo.props().bar).toEqual(123);
        expect(foo.props().visible).toBe(true);
    });

    it('should transduce store state to props by means of [stateToPropsMapper]', () => {
        const FooWrapper = connect(
            storeState$ => storeState$.map(({xyzzy}) => ({baz: xyzzy}))
        )(Foo);
        const fooWrapper = mount(<FooWrapper />);
        const fooProps = () => fooWrapper.find(Foo).props();
        expect(fooProps().baz).toEqual(internals.INITIAL_STORE_STATE.xyzzy);
        internals.storeState = {xyzzy: 123};
        forceUpdate(fooWrapper);
        expect(fooProps().baz).toEqual(123);
    });

    describe('should provide [dispatch] operator/function', () => {
        const doSomething = payload => ({type: 'SIDE_EFFECT', payload});

        it('as argument of [dispatchToActionsMapper] to "push" actions inside store', () => {
            const dispatchToActionsMapper = jest.fn(() => Observable.empty());
            const FooWrapper = connect(
                undefined,
                dispatchToActionsMapper
            )(Foo);
            mount(<FooWrapper />);
            expect(dispatchToActionsMapper).toBeCalled();
            const dispatch = dispatchToActionsMapper.mock.calls[0][0]; // first arg
            expect(isFunction(dispatch)).toBeTruthy();
            dispatch(doSomething(123));
            expect(internals.lastAction).toEqual(doSomething(123));
        });

        it('as argument of [stateToPropsMapper] to "push" actions inside store', () => {
            const stateToPropsMapper = jest.fn(() => Observable.empty());
            const FooWrapper = connect(stateToPropsMapper)(Foo);
            mount(<FooWrapper />);
            expect(stateToPropsMapper).toBeCalled();
            const dispatch = stateToPropsMapper.mock.calls[0][2]; // third arg
            expect(isFunction(dispatch)).toBeTruthy();
            dispatch(doSomething(456));
            expect(internals.lastAction).toEqual(doSomething(456));
        });
    });

    it('should inject declared actions into underlying/wrapped component', () => {
        const FooWrapper = connect(
            undefined,
            () => ({
                toggle: () => Observable.empty()
            })
        )(Foo);
        const fooWrapper = mount(<FooWrapper />);
        const foo = fooWrapper.find(Foo);
        expect(isFunction(foo.props().toggle)).toBeTruthy();
    });

    describe('store actions dispatching', () => {
        const doSomething = payload => ({type: 'SIDE_EFFECT', payload});

        function shouldDispatchCorrectAction(FooWrapper) {
            const fooWrapper = mount(<FooWrapper />);
            const foo = fooWrapper.find(Foo);
            const dispatchedDoSomething = foo.props().doSomething;
            expect(isFunction(dispatchedDoSomething)).toBeTruthy();
            dispatchedDoSomething(123);
            expect(internals.lastAction).toEqual(doSomething(123));
        }

        it('can be defined as function [dispatchToActionsMapper] from dispatch to actions map', () => {
            const FooWrapper = connect(
                undefined,
                dispatch => ({
                    doSomething: payload$ => payload$::dispatch(doSomething).ignoreElements()
                })
            )(Foo);
            shouldDispatchCorrectAction(FooWrapper);
        });

        it('can be defined as actions map (plain object)', () => {
            const FooWrapper = connect(
                undefined,
                {doSomething: payload$ => payload$.map(doSomething)}
            )(Foo);
            shouldDispatchCorrectAction(FooWrapper);
        });

        it('can be defined as actions map (plain object) and passed as first argument', () => {
            const FooWrapper = connect(
                {doSomething: payload$ => payload$.map(doSomething)}
            )(Foo);
            shouldDispatchCorrectAction(FooWrapper);
        });
    });

    it('should interact with underlying/wrapped component by means of actions', () => {
        const FooWrapper = connect(
            undefined,
            () => ({
                toggle: visible$ => visible$.map(visible => ({visible: !visible}))
            })
        )(Foo);
        const fooWrapper = mount(<FooWrapper />);
        const fooProps = () => fooWrapper.find(Foo).props();
        fooProps().toggle(false);
        forceUpdate(fooWrapper);
        expect(fooProps().visible).toBe(true); // visibility inversion
        fooProps().toggle(true);
        forceUpdate(fooWrapper);
        expect(fooProps().visible).toBe(false); // visibility inversion
    });

    it('should interact with store by means of dispatched actions', () => {
        const doToggle = visible => ({type: 'DO_TOGGLE', visible});
        const FooWrapper = connect(
            undefined,
            dispatch => ({
                toggle: visible$ => visible$
                    ::dispatch(doToggle)
                    .ignoreElements()
            })
        )(Foo);
        const fooWrapper = mount(<FooWrapper />);
        const fooProps = () => fooWrapper.find(Foo).props();
        fooProps().toggle(true);
        expect(internals.lastAction).toEqual(doToggle(true));
        fooProps().toggle(false);
        expect(internals.lastAction).toEqual(doToggle(false));
    });

    describe('@connect(stateToPropsMapper, dispatchToActionsMapper)', () => {
        const actionsMapperMock = jest.fn(() => ({}));
        let FooWrapper;
        beforeEach(() => {
            FooWrapper = connect((storeState$, props$) => props$.map(
                ({baz}) => ({quuz: baz})
            ), actionsMapperMock)(Foo);
        });

        it('should pass original props as well as transformed props to [dispatchToActionsMapper]', (done) => {
            mount(<FooWrapper baz={123} />);
            const props$ = actionsMapperMock.mock.calls[0][1];
            props$.subscribe((fooArgs) => {
                expect(fooArgs).toEqual({baz: 123, quuz: 123});
                done();
            });
        });
    });

    describe('should pass completion event on unmount', () => {
        function expectCompletionEvent(connectToOnComplete) {
            const onComplete = jest.fn();
            const FooWrapper = connectToOnComplete(onComplete)(Foo);
            const fooWrapper = mount(<FooWrapper />);
            fooWrapper.unmount();
            expect(onComplete).toHaveBeenCalledTimes(1);
        }

        it('to [storeState$]', () => {
            expectCompletionEvent(
                onComplete => connect(storeState$ => storeState$.finally(onComplete))
            );
        });

        it('to [props$]', () => {
            expectCompletionEvent(
                onComplete => connect((storeState$, props$) => props$.finally(onComplete))
            );
        });

        it('to [mappedActions$]', () => {
            expectCompletionEvent(
                onComplete => connect(undefined, {
                    toggle: visible$ => visible$.finally(onComplete)
                })
            );
        });
    });

    it('should fail if [stateToPropsMapper] is not a function', () => {
        expect(() => connect(null)).toThrow(TypeError);
    });
    it('should fail if [dispatchToActionsMapper] is not a function and not an object', () => {
        expect(() => connect(undefined, null)).toThrow(TypeError);
    });
});

function forceUpdate(fooWrapper) {
    const props = fooWrapper.props();
    fooWrapper.setProps({...props, forceUpdate: !props.forceUpdate});
}
