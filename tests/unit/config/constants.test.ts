import { describe, it, expect } from 'vitest';
import { PRODUCTS, PRODUCT_IDS } from '../../../src/config/constants';

describe('constants', () => {
    describe('PRODUCTS', () => {
        it('contains all required WSO2 products', () => {
            expect(Object.keys(PRODUCTS)).toEqual(
                expect.arrayContaining(['apim', 'choreo', 'ballerina', 'mi', 'bi', 'library'])
            );
        });

        it.each(Object.entries(PRODUCTS))('%s has all required fields', (_, product) => {
            expect(product.id).toBeTruthy();
            expect(product.name).toBeTruthy();
            expect(product.baseUrl).toMatch(/^https:\/\//);
            expect(product.sitemapUrl).toMatch(/^https:\/\//);
            expect(product.description).toBeTruthy();
        });

        it('product ids match keys', () => {
            Object.entries(PRODUCTS).forEach(([key, product]) => {
                expect(product.id).toBe(key);
            });
        });

        it('mi product has a version field', () => {
            expect(PRODUCTS['mi'].version).toBe('4.4.0');
        });
    });

    describe('PRODUCT_IDS', () => {
        it('matches keys of PRODUCTS', () => {
            expect(PRODUCT_IDS.sort()).toEqual(Object.keys(PRODUCTS).sort());
        });

        it('is an array', () => {
            expect(Array.isArray(PRODUCT_IDS)).toBe(true);
        });
    });
});
